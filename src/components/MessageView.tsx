import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { TelegramBridge } from '../hooks/useTelegramBridge';

interface Message {
    telegram_id: number;
    text: string | null;
    from_id: string | null;
    from_name: string | null;
    is_outgoing: boolean;
    timestamp: number;
    media_type: string | null;
    reply_to_id: number | null;
}

interface Props {
    bridge: TelegramBridge;
    accountId: string;
    conversationId: string;
    peerId: string;
    conversationName: string;
    onBack: () => void;
}

export function MessageView({
    bridge,
    accountId,
    conversationId,
    peerId,
    conversationName,
    onBack,
}: Props) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [scrollOffset, setScrollOffset] = useState(0);
    const [inputMode, setInputMode] = useState(false);
    const [inputText, setInputText] = useState('');
    const [sending, setSending] = useState(false);
    const { exit } = useApp();

    // Fetch messages from Telegram
    const fetchMessages = useCallback(async () => {
        try {
            setLoading(true);
            const result = await bridge.fetchMessages(accountId, peerId, 50);
            // Reverse to show oldest first (chronological order)
            setMessages(result.reverse());
            setError(null);
            // Scroll to bottom
            setScrollOffset(Math.max(0, result.length - 15));
        } catch (e: any) {
            setError(e.message || 'Failed to load messages');
        } finally {
            setLoading(false);
        }
    }, [bridge, accountId, peerId]);

    useEffect(() => {
        fetchMessages();
    }, [fetchMessages]);

    // Send message
    const sendMessage = useCallback(async () => {
        if (!inputText.trim()) {
            setInputMode(false);
            return;
        }

        setSending(true);
        try {
            const result = await bridge.sendMessage(accountId, peerId, inputText.trim());
            if (result.success) {
                // Add message locally
                setMessages((prev) => [
                    ...prev,
                    {
                        telegram_id: result.message_id,
                        text: inputText.trim(),
                        from_id: null,
                        from_name: 'You',
                        is_outgoing: true,
                        timestamp: result.timestamp,
                        media_type: null,
                        reply_to_id: null,
                    },
                ]);
                setInputText('');
                setInputMode(false);
                // Scroll to bottom
                setScrollOffset(messages.length - 14);
            } else {
                setError(result.error || 'Failed to send message');
            }
        } catch (e: any) {
            setError(e.message || 'Failed to send message');
        } finally {
            setSending(false);
        }
    }, [bridge, accountId, peerId, inputText, messages.length]);

    useInput((input, key) => {
        if (inputMode) {
            if (key.return) {
                sendMessage();
            } else if (key.escape) {
                setInputMode(false);
                setInputText('');
            }
            return;
        }

        if (loading) return;

        if (key.upArrow) {
            setScrollOffset((o) => Math.max(0, o - 1));
        } else if (key.downArrow) {
            setScrollOffset((o) => Math.min(Math.max(0, messages.length - 15), o + 1));
        } else if (key.pageUp) {
            setScrollOffset((o) => Math.max(0, o - 10));
        } else if (key.pageDown) {
            setScrollOffset((o) => Math.min(Math.max(0, messages.length - 15), o + 10));
        } else if (key.escape || input === 'b') {
            onBack();
        } else if (input === 'q') {
            bridge.cleanup();
            exit();
        } else if (input === 'r') {
            fetchMessages();
        } else if (input === 'i' || input === 'm') {
            setInputMode(true);
        }
    });

    // Format timestamp
    const formatTime = (timestamp: number): string => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    // Get media indicator
    const getMediaIndicator = (type: string | null): string => {
        switch (type) {
            case 'photo': return '📷 Photo';
            case 'video': return '🎬 Video';
            case 'audio': return '🎵 Audio';
            case 'voice': return '🎤 Voice';
            case 'document': return '📎 Document';
            case 'sticker': return '🎨 Sticker';
            default: return '';
        }
    };

    if (loading) {
        return (
            <Box>
                <Text color="cyan">
                    <Spinner type="dots" />
                </Text>
                <Text> Loading messages...</Text>
            </Box>
        );
    }

    if (error) {
        return (
            <Box flexDirection="column">
                <Text color="red">✗ {error}</Text>
                <Text dimColor>Press 'r' to retry or Esc to go back</Text>
            </Box>
        );
    }

    // Display messages with scrolling
    const maxVisible = 15;
    const visibleMessages = messages.slice(scrollOffset, scrollOffset + maxVisible);

    return (
        <Box flexDirection="column">
            {/* Header */}
            <Box marginBottom={1} borderStyle="single" borderColor="cyan" paddingX={1}>
                <Text bold>📨 {conversationName}</Text>
                {messages.length > 0 && (
                    <Text dimColor> ({messages.length} messages)</Text>
                )}
            </Box>

            {/* Messages */}
            <Box flexDirection="column" height={maxVisible + 2}>
                {messages.length === 0 ? (
                    <Text dimColor>No messages yet</Text>
                ) : (
                    visibleMessages.map((msg, i) => (
                        <Box key={msg.telegram_id} flexDirection="column" marginBottom={0}>
                            <Box>
                                <Text color={msg.is_outgoing ? 'green' : 'yellow'}>
                                    {msg.is_outgoing ? '→ ' : '← '}
                                    <Text bold>{msg.is_outgoing ? 'You' : msg.from_name || 'Unknown'}</Text>
                                </Text>
                                <Text dimColor> {formatTime(msg.timestamp)}</Text>
                            </Box>
                            <Box paddingLeft={2}>
                                {msg.media_type && (
                                    <Text color="cyan">{getMediaIndicator(msg.media_type)} </Text>
                                )}
                                <Text>{msg.text || ''}</Text>
                            </Box>
                        </Box>
                    ))
                )}
            </Box>

            {/* Scroll indicator */}
            {messages.length > maxVisible && (
                <Box>
                    <Text dimColor>
                        ── {scrollOffset + 1}-{Math.min(scrollOffset + maxVisible, messages.length)} of {messages.length} ──
                    </Text>
                </Box>
            )}

            {/* Input box */}
            <Box marginTop={1} borderStyle="round" borderColor={inputMode ? 'cyan' : 'gray'} paddingX={1}>
                {inputMode ? (
                    <Box>
                        <Text color="cyan">{'> '}</Text>
                        <TextInput
                            value={inputText}
                            onChange={setInputText}
                            placeholder="Type a message..."
                        />
                        {sending && (
                            <Text color="cyan">
                                <Spinner type="dots" />
                            </Text>
                        )}
                    </Box>
                ) : (
                    <Text dimColor>Press 'i' or 'm' to type a message</Text>
                )}
            </Box>
        </Box>
    );
}
