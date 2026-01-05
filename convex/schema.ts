import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    accounts: defineTable({
        phone: v.string(),
        name: v.optional(v.string()),
        username: v.optional(v.string()),
        sessionString: v.optional(v.string()),
        isActive: v.boolean(),
        saveMessages: v.optional(v.boolean()),
        // Message source filters
        saveFromChannels: v.optional(v.boolean()),
        saveFromBots: v.optional(v.boolean()),
        saveFromPrivate: v.optional(v.boolean()),
        saveFromGroups: v.optional(v.boolean()),
        lastSync: v.optional(v.number()),
    }).index("by_phone", ["phone"]),

    conversations: defineTable({
        accountId: v.id("accounts"),
        peerId: v.string(),
        peerType: v.union(
            v.literal("user"),
            v.literal("chat"),
            v.literal("channel")
        ),
        name: v.string(),
        username: v.optional(v.string()),
        lastMessageAt: v.number(),
        lastMessagePreview: v.optional(v.string()),
        unreadCount: v.number(),
    })
        .index("by_account", ["accountId"])
        .index("by_account_peer", ["accountId", "peerId"])
        .index("by_account_sorted", ["accountId", "lastMessageAt"]),

    messages: defineTable({
        accountId: v.id("accounts"),
        conversationId: v.id("conversations"),
        telegramId: v.number(),
        peerId: v.string(),
        text: v.optional(v.string()),
        fromId: v.optional(v.string()),
        fromName: v.optional(v.string()),
        isOutgoing: v.boolean(),
        timestamp: v.number(),
        mediaType: v.optional(v.string()),
        replyToId: v.optional(v.number()),
    })
        .index("by_conversation", ["conversationId", "timestamp"])
        .index("by_telegram_id", ["accountId", "peerId", "telegramId"]),
});
