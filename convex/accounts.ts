import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
    args: { phone: v.string() },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("accounts")
            .withIndex("by_phone", (q) => q.eq("phone", args.phone))
            .first();

        if (existing) return existing._id;

        return await ctx.db.insert("accounts", {
            phone: args.phone,
            isActive: false,
            saveMessages: true,
            saveFromPrivate: true,
            saveFromChannels: false,
            saveFromBots: false,
            saveFromGroups: false,
        });
    },
});

export const updateSession = mutation({
    args: {
        accountId: v.id("accounts"),
        sessionString: v.string(),
        name: v.optional(v.string()),
        username: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const current = await ctx.db.get(args.accountId);
        const patch: any = {
            sessionString: args.sessionString,
            name: args.name,
            username: args.username,
            isActive: true,
            lastSync: Date.now(),
        };
        if (current?.saveMessages === undefined) patch.saveMessages = true;
        if (current?.saveFromPrivate === undefined) patch.saveFromPrivate = true;
        if (current?.saveFromChannels === undefined) patch.saveFromChannels = false;
        if (current?.saveFromBots === undefined) patch.saveFromBots = false;
        if (current?.saveFromGroups === undefined) patch.saveFromGroups = false;
        await ctx.db.patch(args.accountId, patch);
    },
});

export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("accounts").collect();
    },
});

export const get = query({
    args: { accountId: v.id("accounts") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.accountId);
    },
});

export const getByPhone = query({
    args: { phone: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("accounts")
            .withIndex("by_phone", (q) => q.eq("phone", args.phone))
            .first();
    },
});

export const updateSaveMessages = mutation({
    args: {
        accountId: v.id("accounts"),
        saveMessages: v.boolean(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.accountId, {
            saveMessages: args.saveMessages,
        });
    },
});

export const updateMessageFilters = mutation({
    args: {
        accountId: v.id("accounts"),
        saveFromChannels: v.optional(v.boolean()),
        saveFromBots: v.optional(v.boolean()),
        saveFromPrivate: v.optional(v.boolean()),
        saveFromGroups: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const { accountId, ...filters } = args;
        await ctx.db.patch(accountId, filters);
    },
});
