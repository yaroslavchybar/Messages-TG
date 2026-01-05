import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upsert = mutation({
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
        lastMessageAt: v.number(),
        lastMessagePreview: v.optional(v.nullable(v.string())),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("conversations")
            .withIndex("by_account_peer", (q) =>
                q.eq("accountId", args.accountId).eq("peerId", args.peerId)
            )
            .first();

        if (existing) {
            const patch: any = {
                name: args.name,
                username: args.username,
                lastMessageAt: args.lastMessageAt,
                lastMessagePreview: args.lastMessagePreview,
            };
            for (const key of ["username", "lastMessagePreview"]) {
                if (patch[key] == null) delete patch[key];
            }
            await ctx.db.patch(existing._id, patch);
            return existing._id;
        }

        const doc: any = {
            ...args,
            unreadCount: 0,
        };
        for (const key of ["username", "lastMessagePreview"]) {
            if (doc[key] == null) delete doc[key];
        }
        return await ctx.db.insert("conversations", doc);
    },
});

export const listByAccount = query({
    args: { accountId: v.id("accounts") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("conversations")
            .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
            .collect();
    },
});

export const get = query({
    args: { conversationId: v.id("conversations") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.conversationId);
    },
});

export const incrementUnread = mutation({
    args: { conversationId: v.id("conversations") },
    handler: async (ctx, args) => {
        const conv = await ctx.db.get(args.conversationId);
        if (conv) {
            await ctx.db.patch(args.conversationId, {
                unreadCount: conv.unreadCount + 1,
            });
        }
    },
});

export const clearUnread = mutation({
    args: { conversationId: v.id("conversations") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, { unreadCount: 0 });
    },
});
