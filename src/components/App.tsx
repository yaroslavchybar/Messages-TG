import { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Gradient from 'ink-gradient';
import { LoginScreen } from './LoginScreen';
import { useTelegramBridge } from '../hooks/useTelegramBridge';
import { ConvexProvider, useConvex } from '../context/ConvexContext';
import { api } from '../../convex/_generated/api';
import theme from '../theme';

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
    { key: 'saveFromChannels', label: 'Channels', icon: '' },
    { key: 'saveFromBots', label: 'Bots', icon: '' },
    { key: 'saveFromPrivate', label: 'Private', icon: '' },
    { key: 'saveFromGroups', label: 'Groups', icon: '' },
];

const MAX_LOGS = 6;
const CONTENT_WIDTH = 70;

// Hex color interpolation helper
function interpolateColor(color1: string, color2: string, factor: number): string {
    const r1 = parseInt(color1.slice(1, 3), 16);
    const g1 = parseInt(color1.slice(3, 5), 16);
    const b1 = parseInt(color1.slice(5, 7), 16);
    const r2 = parseInt(color2.slice(1, 3), 16);
    const g2 = parseInt(color2.slice(3, 5), 16);
    const b2 = parseInt(color2.slice(5, 7), 16);

    const r = Math.round(r1 + (r2 - r1) * factor);
    const g = Math.round(g1 + (g2 - g1) * factor);
    const b = Math.round(b1 + (b2 - b1) * factor);

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Shared animation phase for synchronized gradient animation
let globalPhase = 0;
setInterval(() => {
    globalPhase = (globalPhase + 0.05) % (Math.PI * 2);
}, 50);

// Hook for animated gradient colors
function useGradientColors(): string[] {
    const [phase, setPhase] = useState(globalPhase);

    useEffect(() => {
        const interval = setInterval(() => {
            setPhase(globalPhase);
        }, 50);
        return () => clearInterval(interval);
    }, []);

    const wave = (Math.sin(phase) + 1) / 2;
    const wave2 = (Math.sin(phase + Math.PI) + 1) / 2;

    const color1 = interpolateColor('#FF9D00', '#FFAE00', wave);
    const color2 = interpolateColor('#FFAE00', '#FFC300', wave);
    const color3 = interpolateColor('#FFC300', '#FF9D00', wave2);

    return [color1, color2, color3];
}

// Hook for animated green gradient colors
function useGreenGradientColors(): string[] {
    const [phase, setPhase] = useState(globalPhase);

    useEffect(() => {
        const interval = setInterval(() => {
            setPhase(globalPhase);
        }, 50);
        return () => clearInterval(interval);
    }, []);

    const wave = (Math.sin(phase) + 1) / 2;
    const wave2 = (Math.sin(phase + Math.PI) + 1) / 2;

    const color1 = interpolateColor('#00B003', '#4AD84C', wave);
    const color2 = interpolateColor('#4AD84C', '#8AFF8C', wave);
    const color3 = interpolateColor('#8AFF8C', '#00B003', wave2);

    return [color1, color2, color3];
}

// Reusable animated gradient text component (orange)
function GradientText({ children, bold }: { children: React.ReactNode; bold?: boolean }) {
    const colors = useGradientColors();
    return <Gradient colors={colors}>{children}</Gradient>;
}

// Reusable animated green gradient text component
function GreenGradientText({ children }: { children: React.ReactNode }) {
    const colors = useGreenGradientColors();
    return <Gradient colors={colors}>{children}</Gradient>;
}

// Animated gradient section header with smooth wave effect
function SectionHeader({ title }: { title: string }) {
    const colors = useGradientColors();
    const dashes = '─'.repeat(Math.max(0, CONTENT_WIDTH - title.length - 4));

    return (
        <Gradient colors={colors}>
            ─ {title} {dashes}
        </Gradient>
    );
}

// Account card component
function AccountCard({
    account,
    isSelected,
    isConnected
}: {
    account: AccountInfo;
    isSelected: boolean;
    isConnected: boolean;
}) {
    const activeFilters = FILTER_OPTIONS.filter(o => account[o.key]).length;

    return (
        <Box flexDirection="column" marginLeft={1}>
            <Box>
                {isSelected ? (
                    <GradientText>{'> '}</GradientText>
                ) : (
                    <Text>{'  '}</Text>
                )}
                {isConnected ? (
                    <GreenGradientText>{theme.icons.connected}</GreenGradientText>
                ) : (
                    <Text color="gray">{theme.icons.disconnected}</Text>
                )}
                {isSelected ? (
                    <GradientText>{' '}{account.name || 'Unknown'}</GradientText>
                ) : (
                    <Text bold color="white">{' '}{account.name || 'Unknown'}</Text>
                )}
                {account.username && (
                    <Text color="gray"> @{account.username}</Text>
                )}
            </Box>
            <Box marginLeft={4}>
                <Text color="gray">
                    {account.phone}
                    {' '}{theme.icons.bullet}{' '}
                    {account.saveMessages ? (
                        <GreenGradientText>Saving</GreenGradientText>
                    ) : (
                        <Text color="gray">Paused</Text>
                    )}
                    {' '}{theme.icons.bullet}{' '}
                    Filters: {activeFilters}/{FILTER_OPTIONS.length}
                </Text>
            </Box>
        </Box>
    );
}

// Log entry colored by position: first=orange, last=green, middle=gray
function LogEntry({ log, isFirst, isLast }: { log: string; isFirst: boolean; isLast: boolean }) {
    if (isLast) {
        return <GreenGradientText>{log}</GreenGradientText>;
    } else if (isFirst) {
        return <GradientText>{log}</GradientText>;
    }
    return <Text color="gray" wrap="truncate">{log}</Text>;
}

// Footer with keyboard hints  
function Footer() {
    return (
        <Box marginTop={1}>
            <Text color="gray">
                ↑↓ navigate {theme.icons.bullet} a add {theme.icons.bullet} s save {theme.icons.bullet} f filters {theme.icons.bullet} r refresh {theme.icons.bullet} q quit
            </Text>
        </Box>
    );
}

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

    const addLog = (message: string) => {
        const cleanedMessage = stripEmojis(message);
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setLogs(prev => [...prev.slice(-(MAX_LOGS - 1)), `${timestamp}  ${cleanedMessage}`]);
    };

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
        addLog('Started, waiting for messages...');
    }, [bridge]);

    const connectAccount = async (accountId: string, sessionString: string) => {
        if (connectedAccounts.has(accountId)) return;
        try {
            addLog(`Connecting ${accountId.slice(0, 8)}...`);
            const result = await bridge.connectWithSession(accountId, sessionString);
            if (result.success) {
                setConnectedAccounts(prev => new Set([...prev, accountId]));
                addLog(`Connected: ${result.name || 'Account'}`);
            } else {
                addLog(`Failed: ${result.error}`);
            }
        } catch (e: any) {
            addLog(`Error: ${e.message}`);
        }
    };

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
            for (const account of accountList) {
                if (account.sessionString && !connectedAccounts.has(account.id)) {
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

    const toggleSaveMessages = async () => {
        if (!convex || accounts.length === 0) return;
        const account = accounts[selectedIndex];
        if (!account) return;
        try {
            await convex.mutation(api.accounts.updateSaveMessages, {
                accountId: account.id as any,
                saveMessages: !account.saveMessages,
            });
            await loadAccounts();
        } catch (e: any) {
            setError(e.message || 'Failed to update');
        }
    };

    const toggleFilter = async (filterKey: FilterOption['key']) => {
        if (!convex || accounts.length === 0) return;
        const account = accounts[selectedIndex];
        if (!account) return;
        try {
            await convex.mutation(api.accounts.updateMessageFilters, {
                accountId: account.id as any,
                [filterKey]: !account[filterKey],
            });
            await loadAccounts();
        } catch (e: any) {
            setError(e.message || 'Failed to update filter');
        }
    };

    useInput((input, key) => {
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

        if (screen !== 'accounts') return;

        if (key.upArrow && accounts.length > 0) {
            setSelectedIndex((i) => Math.max(0, i - 1));
        } else if (key.downArrow && accounts.length > 0) {
            setSelectedIndex((i) => Math.min(accounts.length - 1, i + 1));
        } else if (input === 'a') {
            setScreen('login');
        } else if (input === 's' && accounts.length > 0) {
            toggleSaveMessages();
        } else if (input === 'f' && accounts.length > 0) {
            setScreen('filters');
        } else if (input === 'c') {
            setLogs([]);
        } else if (input === 'r') {
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
                <LoginScreen
                    bridge={bridge}
                    onSuccess={handleLoginSuccess}
                    onError={setError}
                    onCancel={() => setScreen('accounts')}
                />
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
                <Box marginBottom={1}>
                    <GradientText>Message Filters</GradientText>
                    <Text color="gray"> {theme.icons.bullet} {account.name || account.phone}</Text>
                </Box>

                {/* Filter options */}
                <Box flexDirection="column" marginBottom={1}>
                    <SectionHeader title="Sources" />
                    <Box flexDirection="column" marginTop={1}>
                        {FILTER_OPTIONS.map((option, i) => {
                            const isSelected = i === filterIndex;
                            const isEnabled = account[option.key];
                            return (
                                <Box key={option.key} marginLeft={1}>
                                    {isSelected ? (
                                        <GradientText>{'> '}{option.icon} {option.label}</GradientText>
                                    ) : (
                                        <Text>{'  '}{option.icon} {option.label}</Text>
                                    )}
                                    <Text color={isEnabled ? 'green' : 'gray'}>
                                        {' '}{isEnabled ? theme.icons.check : theme.icons.cross}
                                    </Text>
                                </Box>
                            );
                        })}
                    </Box>
                </Box>

                {/* Footer */}
                <Box marginTop={1}>
                    <Text color="gray">
                        ↑↓ navigate {theme.icons.bullet} enter toggle {theme.icons.bullet} esc back {theme.icons.bullet} q quit
                    </Text>
                </Box>
            </Box>
        );
    }

    // Main accounts screen
    return (
        <Box flexDirection="column" padding={1}>
            {/* Header */}
            <Box marginBottom={1}>
                <GradientText>Telegram Manager</GradientText>
                <Text color="gray">
                    {' '}{theme.icons.bullet}{' '}
                    {connectedAccounts.size}/{accounts.length} connected
                </Text>
            </Box>

            {/* Error display */}
            {error && (
                <Box marginBottom={1}>
                    <Text color="red">{theme.icons.cross} {error}</Text>
                </Box>
            )}

            {/* Accounts section */}
            <Box flexDirection="column" marginBottom={1}>
                <SectionHeader title="Accounts" />
                <Box marginTop={1} flexDirection="column">
                    {loading ? (
                        <Text color="gray">Loading...</Text>
                    ) : accounts.length === 0 ? (
                        <Text color="gray">No accounts. Press 'a' to add.</Text>
                    ) : (
                        accounts.map((account, i) => (
                            <AccountCard
                                key={account.id}
                                account={account}
                                isSelected={i === selectedIndex}
                                isConnected={connectedAccounts.has(account.id)}
                            />
                        ))
                    )}
                </Box>
            </Box>

            {/* Logs section */}
            <Box flexDirection="column" marginTop={1}>
                <SectionHeader title="Activity" />
                <Box flexDirection="column" marginTop={1} marginLeft={1} height={MAX_LOGS}>
                    {logs.length === 0 ? (
                        <Text color="gray">No activity yet...</Text>
                    ) : (
                        logs.map((log, i) => (
                            <LogEntry
                                key={i}
                                log={log}
                                isFirst={i === 0}
                                isLast={i === logs.length - 1}
                            />
                        ))
                    )}
                </Box>
            </Box>

            {/* Footer */}
            <Footer />
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
