import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const ingestArgs = {
    accountId: v.id("accounts"),
    peerId: v.string(),
    peerType: v.union(v.literal("user"), v.literal("chat"), v.literal("channel")),
    name: v.string(),
    username: v.optional(v.nullable(v.string())),
    telegramId: v.number(),
    text: v.optional(v.nullable(v.string())),
    fromId: v.optional(v.nullable(v.string())),
    fromName: v.optional(v.nullable(v.string())),
    isOutgoing: v.boolean(),
    timestamp: v.number(),
    mediaType: v.optional(v.nullable(v.string())),
    replyToId: v.optional(v.nullable(v.number())),
    isBot: v.optional(v.boolean()),
} as const;

const decision = (account: any, args: any): { ok: true } | { ok: false; reason: string } => {
    if (args.peerId === "777000") {
        return { ok: false, reason: "excluded_peer" };
    }

    const saveMessages = account?.saveMessages ?? true;
    if (!saveMessages) {
        return { ok: false, reason: "saveMessages_off" };
    }

    if (!args.isOutgoing) {
        const isBot = args.isBot ?? false;
        const saveFromBots = account?.saveFromBots ?? false;
        const saveFromChannels = account?.saveFromChannels ?? false;
        const saveFromGroups = account?.saveFromGroups ?? false;
        const saveFromPrivate = account?.saveFromPrivate ?? true;

        if (isBot && !saveFromBots) {
            return { ok: false, reason: "saveFromBots_off" };
        }
        if (args.peerType === "channel" && !saveFromChannels) {
            return { ok: false, reason: "saveFromChannels_off" };
        }
        if (args.peerType === "chat" && !saveFromGroups) {
            return { ok: false, reason: "saveFromGroups_off" };
        }
        if (args.peerType === "user" && !isBot && !saveFromPrivate) {
            return { ok: false, reason: "saveFromPrivate_off" };
        }
    }

    return { ok: true };
};

const buildLastMessagePreview = (text: string | null | undefined) => {
    return ((text ?? "") || "[media]").slice(0, 100);
};

const buildConvPatch = (args: any) => {
    const lastMessagePreview = buildLastMessagePreview(args.text);
    const convPatch: any = {
        name: args.name,
        peerType: args.peerType,
        username: args.username,
        lastMessageAt: args.timestamp,
        lastMessagePreview,
    };
    for (const key of ["username", "lastMessagePreview"]) {
        if (convPatch[key] == null) delete convPatch[key];
    }
    return convPatch;
};

const buildMsgDoc = (args: any, conversationId: any) => {
    const msgDoc: any = {
        accountId: args.accountId,
        conversationId,
        telegramId: args.telegramId,
        peerId: args.peerId,
        text: args.text,
        fromId: args.fromId,
        fromName: args.fromName,
        isOutgoing: args.isOutgoing,
        timestamp: args.timestamp,
        mediaType: args.mediaType,
        replyToId: args.replyToId,
    };

    for (const key of ["text", "fromId", "fromName", "mediaType", "replyToId"]) {
        if (msgDoc[key] == null) delete msgDoc[key];
    }

    return msgDoc;
};

const ingestOne = async (ctx: any, args: any) => {
    const account = await ctx.db.get(args.accountId);
    const d = decision(account, args);
    if (!d.ok) {
        return { saved: false, reason: d.reason };
    }

    const existingConv = await ctx.db
        .query("conversations")
        .withIndex("by_account_peer", (q: any) =>
            q.eq("accountId", args.accountId).eq("peerId", args.peerId)
        )
        .first();

    const convPatch = buildConvPatch(args);

    let conversationId;
    if (existingConv) {
        await ctx.db.patch(existingConv._id, convPatch);
        conversationId = existingConv._id;
    } else {
        const convDoc: any = {
            accountId: args.accountId,
            peerId: args.peerId,
            unreadCount: 0,
            ...convPatch,
        };
        conversationId = await ctx.db.insert("conversations", convDoc);
    }

    const existingMsg = await ctx.db
        .query("messages")
        .withIndex("by_telegram_id", (q: any) =>
            q
                .eq("accountId", args.accountId)
                .eq("peerId", args.peerId)
                .eq("telegramId", args.telegramId)
        )
        .first();

    if (existingMsg) {
        return {
            saved: true,
            conversationId,
            messageId: existingMsg._id,
            deduped: true,
        };
    }

    const messageId = await ctx.db.insert("messages", buildMsgDoc(args, conversationId));
    return { saved: true, conversationId, messageId, deduped: false };
};

export const insert = mutation({
    args: {
        accountId: v.id("accounts"),
        conversationId: v.union(
            v.id("conversations"),
            v.object({
                status: v.literal("success"),
                value: v.id("conversations"),
            })
        ),
        telegramId: v.number(),
        peerId: v.string(),
        text: v.optional(v.nullable(v.string())),
        fromId: v.optional(v.nullable(v.string())),
        fromName: v.optional(v.nullable(v.string())),
        isOutgoing: v.boolean(),
        timestamp: v.number(),
        mediaType: v.optional(v.nullable(v.string())),
        replyToId: v.optional(v.nullable(v.number())),
    },
    handler: async (ctx, args) => {
        const conversationId =
            typeof args.conversationId === "string"
                ? args.conversationId
                : args.conversationId.value;

        // Check for duplicates by Telegram message ID
        const existing = await ctx.db
            .query("messages")
            .withIndex("by_telegram_id", (q) =>
                q
                    .eq("accountId", args.accountId)
                    .eq("peerId", args.peerId)
                    .eq("telegramId", args.telegramId)
            )
            .first();

        if (existing) return existing._id;
        const doc: any = { ...args, conversationId };
        for (const key of ["text", "fromId", "fromName", "mediaType", "replyToId"]) {
            if (doc[key] == null) delete doc[key];
        }
        return await ctx.db.insert("messages", doc);
    },
});

export const ingest = mutation({
    args: ingestArgs,
    handler: async (ctx, args) => {
        return await ingestOne(ctx, args);
    },
});

export const batchIngest = mutation({
    args: {
        messages: v.array(v.object(ingestArgs)),
    },
    handler: async (ctx, args) => {
        const results: any[] = new Array(args.messages.length);
        let savedCount = 0;
        let skippedCount = 0;
        let dedupedCount = 0;

        const accountsById = new Map<string, any>();

        const conversationsByKey = new Map<
            string,
            {
                accountId: any;
                peerId: string;
                existing: any | null;
                patch: any;
                lastTimestamp: number;
                conversationId: any | null;
            }
        >();

        const toInsert: Array<{ index: number; args: any; key: string }> = [];

        for (let i = 0; i < args.messages.length; i++) {
            const message = args.messages[i];
            const accountKey = String(message.accountId);
            let account = accountsById.get(accountKey);
            if (account === undefined) {
                account = await ctx.db.get(message.accountId);
                accountsById.set(accountKey, account);
            }

            const d = decision(account, message);
            if (!d.ok) {
                results[i] = { saved: false, reason: d.reason };
                skippedCount += 1;
                continue;
            }

            const key = `${String(message.accountId)}|${message.peerId}`;
            let conv = conversationsByKey.get(key);
            if (!conv) {
                const existing = await ctx.db
                    .query("conversations")
                    .withIndex("by_account_peer", (q: any) =>
                        q.eq("accountId", message.accountId).eq("peerId", message.peerId)
                    )
                    .first();

                conv = {
                    accountId: message.accountId,
                    peerId: message.peerId,
                    existing: existing ?? null,
                    patch: buildConvPatch(message),
                    lastTimestamp: message.timestamp,
                    conversationId: existing?._id ?? null,
                };
                conversationsByKey.set(key, conv);
            } else if (message.timestamp >= conv.lastTimestamp) {
                conv.patch = buildConvPatch(message);
                conv.lastTimestamp = message.timestamp;
            }

            toInsert.push({ index: i, args: message, key });
        }

        for (const conv of conversationsByKey.values()) {
            if (conv.conversationId) {
                await ctx.db.patch(conv.conversationId, conv.patch);
                continue;
            }

            const convDoc: any = {
                accountId: conv.accountId,
                peerId: conv.peerId,
                unreadCount: 0,
                ...conv.patch,
            };
            conv.conversationId = await ctx.db.insert("conversations", convDoc);
        }

        for (const item of toInsert) {
            const conv = conversationsByKey.get(item.key);
            if (!conv?.conversationId) {
                results[item.index] = { saved: false, reason: "missing_conversation" };
                skippedCount += 1;
                continue;
            }

            const existingMsg = await ctx.db
                .query("messages")
                .withIndex("by_telegram_id", (q: any) =>
                    q
                        .eq("accountId", item.args.accountId)
                        .eq("peerId", item.args.peerId)
                        .eq("telegramId", item.args.telegramId)
                )
                .first();

            if (existingMsg) {
                results[item.index] = {
                    saved: true,
                    conversationId: conv.conversationId,
                    messageId: existingMsg._id,
                    deduped: true,
                };
                savedCount += 1;
                dedupedCount += 1;
                continue;
            }

            const messageId = await ctx.db.insert(
                "messages",
                buildMsgDoc(item.args, conv.conversationId)
            );
            results[item.index] = {
                saved: true,
                conversationId: conv.conversationId,
                messageId,
                deduped: false,
            };
            savedCount += 1;
        }

        return { savedCount, skippedCount, dedupedCount, results };
    },
});

export const listByConversation = query({
    args: {
        conversationId: v.id("conversations"),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) =>
                q.eq("conversationId", args.conversationId)
            )
            .order("desc")
            .take(args.limit ?? 50);
    },
});

export const getLatest = query({
    args: { conversationId: v.id("conversations") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) =>
                q.eq("conversationId", args.conversationId)
            )
            .order("desc")
            .first();
    },
});
