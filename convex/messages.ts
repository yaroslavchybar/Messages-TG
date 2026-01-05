import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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
    args: {
        accountId: v.id("accounts"),
        peerId: v.string(),
        peerType: v.union(
            v.literal("user"),
            v.literal("chat"),
            v.literal("channel")
        ),
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
    },
    handler: async (ctx, args) => {
        if (args.peerId === "777000") {
            return { saved: false, reason: "excluded_peer" };
        }

        const account = await ctx.db.get(args.accountId);
        const saveMessages = account?.saveMessages ?? true;
        if (!saveMessages) {
            return { saved: false, reason: "saveMessages_off" };
        }

        if (!args.isOutgoing) {
            const isBot = args.isBot ?? false;
            const saveFromBots = account?.saveFromBots ?? false;
            const saveFromChannels = account?.saveFromChannels ?? false;
            const saveFromGroups = account?.saveFromGroups ?? false;
            const saveFromPrivate = account?.saveFromPrivate ?? true;

            if (isBot && !saveFromBots) {
                return { saved: false, reason: "saveFromBots_off" };
            }
            if (args.peerType === "channel" && !saveFromChannels) {
                return { saved: false, reason: "saveFromChannels_off" };
            }
            if (args.peerType === "chat" && !saveFromGroups) {
                return { saved: false, reason: "saveFromGroups_off" };
            }
            if (args.peerType === "user" && !isBot && !saveFromPrivate) {
                return { saved: false, reason: "saveFromPrivate_off" };
            }
        }

        const existingConv = await ctx.db
            .query("conversations")
            .withIndex("by_account_peer", (q) =>
                q.eq("accountId", args.accountId).eq("peerId", args.peerId)
            )
            .first();

        const lastMessagePreview = ((args.text ?? "") || "[media]").slice(0, 100);

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

        let conversationId;
        if (existingConv) {
            await ctx.db.patch(existingConv._id, convPatch);
            conversationId = existingConv._id;
        } else {
            const convDoc: any = {
                accountId: args.accountId,
                peerId: args.peerId,
                peerType: args.peerType,
                name: args.name,
                username: args.username,
                lastMessageAt: args.timestamp,
                lastMessagePreview,
                unreadCount: 0,
            };
            for (const key of ["username", "lastMessagePreview"]) {
                if (convDoc[key] == null) delete convDoc[key];
            }
            conversationId = await ctx.db.insert("conversations", convDoc);
        }

        const existingMsg = await ctx.db
            .query("messages")
            .withIndex("by_telegram_id", (q) =>
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

        const messageId = await ctx.db.insert("messages", msgDoc);
        return { saved: true, conversationId, messageId, deduped: false };
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
