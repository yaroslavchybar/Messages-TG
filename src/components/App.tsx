import { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { LoginScreen } from './LoginScreen';
import { useTelegramBridge } from '../hooks/useTelegramBridge';
import { ConvexProvider, useConvex } from '../context/ConvexContext';
import { api } from '../../convex/_generated/api';

type Screen = 'accounts' | 'login' | 'filters';

interface AccountInfo {
    id: string;
    phone: string;
    name?: string;
    username?: string;
    isActive: boolean;
    saveMessages: boolean;
    saveFromChannels: boolean;
    saveFromBots: boolean;
    saveFromPrivate: boolean;
    saveFromGroups: boolean;
    sessionString?: string;
    connected: boolean;
}

interface FilterOption {
    key: 'saveFromChannels' | 'saveFromBots' | 'saveFromPrivate' | 'saveFromGroups';
    label: string;
    icon: string;
}

const FILTER_OPTIONS: FilterOption[] = [
    { key: 'saveFromChannels', label: 'Channels', icon: '📢' },
    { key: 'saveFromBots', label: 'Bots', icon: '🤖' },
    { key: 'saveFromPrivate', label: 'Private Users', icon: '👤' },
    { key: 'saveFromGroups', label: 'Groups', icon: '👥' },
];

const MAX_LOGS = 8;

const stripEmojis = (input: string) =>
    input
        .replace(/[\uFE0F\u200D]/g, '')
        .replace(/\p{Extended_Pictographic}/gu, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

function AccountManager() {
    const [screen, setScreen] = useState<Screen>('accounts');
    const [accounts, setAccounts] = useState<AccountInfo[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [filterIndex, setFilterIndex] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [logs, setLogs] = useState<string[]>([]);
    const [connectedAccounts, setConnectedAccounts] = useState<Set<string>>(new Set());
    const bridge = useTelegramBridge();
    const convex = useConvex();
    const { exit } = useApp();

    // Add log entry
    const addLog = (message: string) => {
        const cleanedMessage = stripEmojis(message);
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev.slice(-(MAX_LOGS - 1)), `[${timestamp}] ${cleanedMessage}`]);
    };

    // Handle Ctrl+C
    useEffect(() => {
        const handleExit = () => {
            bridge.cleanup();
            exit();
        };

        process.on('SIGINT', handleExit);
        process.on('SIGTERM', handleExit);

        return () => {
            process.off('SIGINT', handleExit);
            process.off('SIGTERM', handleExit);
        };
    }, [bridge, exit]);

    // Set up notification listener for logs
    useEffect(() => {
        bridge.onNotification((notification: any) => {
            if (notification.type === 'log') {
                addLog(notification.message);
            } else if (notification.type === 'new_message') {
                addLog(`New message in ${notification.peer_id}`);
            } else if (notification.type === 'error') {
                addLog(`Error: ${notification.message}`);
            } else if (notification.type === 'sync') {
                if (notification.saved) {
                    addLog(notification.message);
                }
            }
        });
        addLog('TUI started, waiting for messages...');
    }, [bridge]);

    // Connect account using session
    const connectAccount = async (accountId: string, sessionString: string) => {
        if (connectedAccounts.has(accountId)) return;

        try {
            addLog(`Connecting account ${accountId.slice(0, 8)}...`);
            const result = await bridge.connectWithSession(accountId, sessionString);
            if (result.success) {
                setConnectedAccounts(prev => new Set([...prev, accountId]));
                addLog(`Connected: ${result.name || 'Account'}`);
            } else {
                addLog(`Failed to connect: ${result.error}`);
            }
        } catch (e: any) {
            addLog(`Connection error: ${e.message}`);
        }
    };

    // Load accounts from Convex
    const loadAccounts = async () => {
        if (!convex) return;
        setLoading(true);
        try {
            const result = await convex.query(api.accounts.list, {});
            const accountList = result.map((a: any) => ({
                id: a._id,
                phone: a.phone,
                name: a.name,
                username: a.username,
                isActive: a.isActive,
                saveMessages: a.saveMessages ?? true,
                saveFromChannels: a.saveFromChannels ?? true,
                saveFromBots: a.saveFromBots ?? true,
                saveFromPrivate: a.saveFromPrivate ?? true,
                saveFromGroups: a.saveFromGroups ?? true,
                sessionString: a.sessionString,
                connected: connectedAccounts.has(a._id),
            }));
            setAccounts(accountList);

            // Auto-connect accounts that have session strings
            for (const account of accountList) {
                if (account.sessionString && !connectedAccounts.has(account.id)) {
                    // Connect in background
                    connectAccount(account.id, account.sessionString);
                }
            }
        } catch (e: any) {
            setError(e.message || 'Failed to load accounts');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAccounts();
    }, [convex]);

    // Toggle save messages for selected account
    const toggleSaveMessages = async () => {
        if (!convex || accounts.length === 0) return;
        const account = accounts[selectedIndex];
        if (!account) return;

        try {
            await convex.mutation(api.accounts.updateSaveMessages, {
                accountId: account.id as any,
                saveMessages: !account.saveMessages,
            });
            // Refresh accounts
            await loadAccounts();
        } catch (e: any) {
            setError(e.message || 'Failed to update setting');
        }
    };

    // Toggle a specific filter for selected account
    const toggleFilter = async (filterKey: FilterOption['key']) => {
        if (!convex || accounts.length === 0) return;
        const account = accounts[selectedIndex];
        if (!account) return;

        try {
            await convex.mutation(api.accounts.updateMessageFilters, {
                accountId: account.id as any,
                [filterKey]: !account[filterKey],
            });
            // Refresh accounts
            await loadAccounts();
        } catch (e: any) {
            setError(e.message || 'Failed to update filter');
        }
    };

    useInput((input, key) => {
        // Filter screen controls
        if (screen === 'filters') {
            if (key.escape || input === 'b') {
                setScreen('accounts');
                setFilterIndex(0);
            } else if (key.upArrow) {
                setFilterIndex((i) => Math.max(0, i - 1));
            } else if (key.downArrow) {
                setFilterIndex((i) => Math.min(FILTER_OPTIONS.length - 1, i + 1));
            } else if (key.return || input === ' ') {
                toggleFilter(FILTER_OPTIONS[filterIndex].key);
            } else if (input === 'q') {
                bridge.cleanup();
                exit();
            }
            return;
        }

        // Accounts screen controls
        if (screen !== 'accounts') return;

        if (key.upArrow && accounts.length > 0) {
            setSelectedIndex((i) => Math.max(0, i - 1));
        } else if (key.downArrow && accounts.length > 0) {
            setSelectedIndex((i) => Math.min(accounts.length - 1, i + 1));
        } else if (input === 'a') {
            // Add new account
            setScreen('login');
        } else if (input === 's' && accounts.length > 0) {
            // Toggle save messages
            toggleSaveMessages();
        } else if (input === 'f' && accounts.length > 0) {
            // Open filter settings
            setScreen('filters');
        } else if (input === 'c') {
            setLogs([]);
        } else if (input === 'r') {
            // Refresh accounts
            loadAccounts();
        } else if (input === 'q') {
            bridge.cleanup();
            exit();
        }
    });

    const handleLoginSuccess = async () => {
        setScreen('accounts');
        setError(null);
        await loadAccounts();
    };

    // Login screen
    if (screen === 'login') {
        return (
            <Box flexDirection="column" padding={1}>
                <Box marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={2}>
                    <Text bold color="cyan">📱 Telegram Account Manager</Text>
                </Box>
                <LoginScreen
                    bridge={bridge}
                    onSuccess={handleLoginSuccess}
                    onError={setError}
                    onCancel={() => setScreen('accounts')}
                />
                <Box marginTop={1}>
                    <Text dimColor>Press Esc to cancel</Text>
                </Box>
            </Box>
        );
    }

    // Filter screen
    if (screen === 'filters') {
        const account = accounts[selectedIndex];
        if (!account) {
            setScreen('accounts');
            return null;
        }

        return (
            <Box flexDirection="column" padding={1}>
                {/* Header */}
                <Box marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={2}>
                    <Text bold color="cyan">🔧 Message Filters</Text>
                    <Text color="gray"> - {account.name || account.phone}</Text>
                </Box>

                {/* Error display */}
                {error && (
                    <Box marginBottom={1}>
                        <Text color="red">⚠ {error}</Text>
                    </Box>
                )}

                {/* Description */}
                <Box marginBottom={1}>
                    <Text>Select which message sources to save:</Text>
                </Box>

                {/* Filter options */}
                <Box flexDirection="column" marginBottom={1}>
                    {FILTER_OPTIONS.map((option, i) => {
                        const isSelected = i === filterIndex;
                        const isEnabled = account[option.key];
                        return (
                            <Box key={option.key} paddingX={1}>
                                <Text
                                    backgroundColor={isSelected ? 'blue' : undefined}
                                    color={isSelected ? 'white' : undefined}
                                >
                                    {isSelected ? '▶ ' : '  '}
                                    <Text>{option.icon} </Text>
                                    <Text bold>{option.label}</Text>
                                    <Text>  </Text>
                                    <Text color={isEnabled ? 'green' : 'red'}>
                                        [{isEnabled ? '✓ ON' : '✗ OFF'}]
                                    </Text>
                                </Text>
                            </Box>
                        );
                    })}
                </Box>

                {/* Summary */}
                <Box marginTop={1} paddingX={1}>
                    <Text dimColor>
                        Active filters: {' '}
                        {FILTER_OPTIONS.filter(o => account[o.key]).map(o => o.label).join(', ') || 'None'}
                    </Text>
                </Box>

                {/* Footer with controls */}
                <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
                    <Text dimColor>
                        ↑↓ navigate • Enter/Space toggle • Esc back • q quit
                    </Text>
                </Box>
            </Box>
        );
    }

    // Main accounts screen
    return (
        <Box flexDirection="column" padding={1}>
            {/* Header */}
            <Box marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={2}>
                <Text bold color="cyan">📱 Telegram Account Manager</Text>
            </Box>

            {/* Error display */}
            {error && (
                <Box marginBottom={1}>
                    <Text color="red">⚠ {error}</Text>
                </Box>
            )}

            {/* Accounts list */}
            <Box flexDirection="column" marginBottom={1}>
                <Text bold>Accounts ({accounts.length}):</Text>
                <Box marginTop={1} flexDirection="column">
                    {loading ? (
                        <Text dimColor>Loading accounts...</Text>
                    ) : accounts.length === 0 ? (
                        <Text dimColor>No accounts yet. Press 'a' to add one.</Text>
                    ) : (
                        accounts.map((account, i) => {
                            const isSelected = i === selectedIndex;
                            const activeFilters = FILTER_OPTIONS.filter(o => account[o.key]).length;
                            const isConnected = connectedAccounts.has(account.id);
                            return (
                                <Box key={account.id} paddingX={1}>
                                    <Text
                                        backgroundColor={isSelected ? 'blue' : undefined}
                                        color={isSelected ? 'white' : undefined}
                                    >
                                        {isSelected ? '▶ ' : '  '}
                                        <Text color={isConnected ? 'green' : 'yellow'}>
                                            {isConnected ? '🔗' : '⚪'}
                                        </Text>
                                        <Text bold> {account.name || account.phone}</Text>
                                        {account.username && (
                                            <Text dimColor={!isSelected}> @{account.username}</Text>
                                        )}
                                        <Text dimColor={!isSelected}> ({account.phone})</Text>
                                        <Text color={account.saveMessages ? 'green' : 'red'}>
                                            {' '}[Save: {account.saveMessages ? 'ON' : 'OFF'}]
                                        </Text>
                                        <Text dimColor={!isSelected}>
                                            {' '}[Filters: {activeFilters}/{FILTER_OPTIONS.length}]
                                        </Text>
                                    </Text>
                                </Box>
                            );
                        })
                    )}
                </Box>
            </Box>

            {/* Logs panel */}
            <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
                <Text bold dimColor>📋 Logs:</Text>
                <Box flexDirection="column" height={MAX_LOGS}>
                    {logs.length === 0 ? (
                        <Text dimColor>No activity yet...</Text>
                    ) : (
                        logs.map((log, i) => (
                            <Text key={i} dimColor wrap="truncate">{log}</Text>
                        ))
                    )}
                </Box>
            </Box>

            {/* Footer with controls */}
            <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
                <Text dimColor>
                    ↑↓ navigate • a add • s toggle save • f filters • c clear logs • r refresh • q quit
                </Text>
            </Box>
        </Box>
    );
}

export function App() {
    return (
        <ConvexProvider>
            <AccountManager />
        </ConvexProvider>
    );
}
