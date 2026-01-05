import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
import { TelegramBridge } from '../hooks/useTelegramBridge';

interface Dialog {
    peer_id: string;
    peer_type: 'user' | 'chat' | 'channel';
    name: string;
    username: string | null;
    unread_count: number;
    last_message: string | null;
    last_message_at: number | null;
}

interface Props {
    bridge: TelegramBridge;
    accountId: string;
    onSelect: (conv: { id: string; peerId: string; name: string }) => void;
    onBack: () => void;
}

export function ConversationList({ bridge, accountId, onSelect, onBack }: Props) {
    const [dialogs, setDialogs] = useState<Dialog[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const { exit } = useApp();

    // Fetch dialogs from Telegram
    const fetchDialogs = useCallback(async () => {
        try {
            setLoading(true);
            const result = await bridge.getDialogs(accountId);
            // Sort by last message time, most recent first
            const sorted = result.sort((a: Dialog, b: Dialog) => {
                const aTime = a.last_message_at || 0;
                const bTime = b.last_message_at || 0;
                return bTime - aTime;
            });
            setDialogs(sorted);
            setError(null);
        } catch (e: any) {
            setError(e.message || 'Failed to load conversations');
        } finally {
            setLoading(false);
        }
    }, [bridge, accountId]);

    useEffect(() => {
        fetchDialogs();
    }, [fetchDialogs]);

    useInput((input, key) => {
        if (loading) return;

        if (key.upArrow) {
            setSelectedIndex((i) => Math.max(0, i - 1));
        } else if (key.downArrow) {
            setSelectedIndex((i) => Math.min(dialogs.length - 1, i + 1));
        } else if (key.return && dialogs[selectedIndex]) {
            const dialog = dialogs[selectedIndex];
            onSelect({
                id: dialog.peer_id, // Using peer_id as conversation id for now
                peerId: dialog.peer_id,
                name: dialog.name,
            });
        } else if (key.escape || input === 'b') {
            onBack();
        } else if (input === 'q') {
            bridge.cleanup();
            exit();
        } else if (input === 'r') {
            fetchDialogs();
        }
    });

    // Get peer type icon
    const getPeerIcon = (type: string): string => {
        switch (type) {
            case 'channel': return '📢';
            case 'chat': return '👥';
            default: return '👤';
        }
    };

    // Format time
    const formatTime = (timestamp: number | null): string => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();

        if (isToday) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    // Truncate text
    const truncate = (text: string | null, maxLen: number): string => {
        if (!text) return '';
        return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
    };

    if (loading) {
        return (
            <Box>
                <Text color="cyan">
                    <Spinner type="dots" />
                </Text>
                <Text> Loading conversations...</Text>
            </Box>
        );
    }

    if (error) {
        return (
            <Box flexDirection="column">
                <Text color="red">✗ {error}</Text>
                <Text dimColor>Press 'r' to retry or 'b' to go back</Text>
            </Box>
        );
    }

    if (dialogs.length === 0) {
        return (
            <Box flexDirection="column">
                <Text>No conversations found</Text>
                <Text dimColor>Press 'r' to refresh or 'b' to go back</Text>
            </Box>
        );
    }

    // Display at most 15 items with scrolling
    const maxVisible = 15;
    const startIndex = Math.max(0, Math.min(selectedIndex - 7, dialogs.length - maxVisible));
    const visibleDialogs = dialogs.slice(startIndex, startIndex + maxVisible);

    return (
        <Box flexDirection="column">
            <Box marginBottom={1}>
                <Text bold>💬 Conversations</Text>
                <Text dimColor> ({dialogs.length} total)</Text>
            </Box>

            <Box flexDirection="column">
                {visibleDialogs.map((dialog, i) => {
                    const actualIndex = startIndex + i;
                    const isSelected = actualIndex === selectedIndex;

                    return (
                        <Box key={dialog.peer_id} paddingX={1}>
                            <Text
                                backgroundColor={isSelected ? 'blue' : undefined}
                                color={isSelected ? 'white' : undefined}
                            >
                                <Text>{getPeerIcon(dialog.peer_type)} </Text>
                                {dialog.unread_count > 0 && (
                                    <Text color={isSelected ? 'white' : 'green'} bold>
                                        ({dialog.unread_count}){' '}
                                    </Text>
                                )}
                                <Text bold={dialog.unread_count > 0}>
                                    {truncate(dialog.name, 25)}
                                </Text>
                                {dialog.username && (
                                    <Text dimColor={!isSelected}> @{dialog.username}</Text>
                                )}
                            </Text>
                            <Box flexGrow={1} />
                            <Text dimColor={!isSelected}>
                                {formatTime(dialog.last_message_at)}
                            </Text>
                        </Box>
                    );
                })}
            </Box>

            {dialogs.length > maxVisible && (
                <Box marginTop={1}>
                    <Text dimColor>
                        Showing {startIndex + 1}-{Math.min(startIndex + maxVisible, dialogs.length)} of {dialogs.length}
                    </Text>
                </Box>
            )}
        </Box>
    );
}
