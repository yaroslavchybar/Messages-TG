import React, { useState, useCallback, useEffect } from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import Gradient from 'ink-gradient';
import { TelegramBridge } from '../hooks/useTelegramBridge';
import { useConvex } from '../context/ConvexContext';
import { api } from '../../convex/_generated/api';
import theme from '../theme';

type Step = 'phone' | 'code' | '2fa' | 'loading' | 'success';

const LOGIN_STATE_FILE = path.join(process.cwd(), '.login_state.json');

type PersistedLoginState = {
    phone: string;
    accountId: string;
    phoneCodeHash: string;
    step: 'code' | '2fa';
    timestamp: number;
};

function saveLoginState(state: PersistedLoginState) {
    try {
        fs.writeFileSync(LOGIN_STATE_FILE, JSON.stringify(state), 'utf-8');
    } catch {
        return;
    }
}

function loadLoginState(): PersistedLoginState | null {
    try {
        if (!fs.existsSync(LOGIN_STATE_FILE)) return null;
        const raw = fs.readFileSync(LOGIN_STATE_FILE, 'utf-8');
        const data = JSON.parse(raw) as Partial<PersistedLoginState>;

        if (
            typeof data.phone !== 'string' ||
            typeof data.accountId !== 'string' ||
            typeof data.phoneCodeHash !== 'string' ||
            (data.step !== 'code' && data.step !== '2fa') ||
            typeof data.timestamp !== 'number'
        ) {
            return null;
        }

        if (Date.now() - data.timestamp >= 5 * 60 * 1000) {
            try {
                fs.unlinkSync(LOGIN_STATE_FILE);
            } catch {
                return null;
            }
            return null;
        }

        return data as PersistedLoginState;
    } catch {
        return null;
    }
}

function clearLoginState() {
    try {
        fs.unlinkSync(LOGIN_STATE_FILE);
    } catch {
        return;
    }
}

interface AccountState {
    id: string;
    phone: string;
    name?: string;
    username?: string;
}

interface Props {
    bridge: TelegramBridge;
    onSuccess: (account?: AccountState) => void;
    onError: (error: string) => void;
    onCancel?: () => void;
}

const STEPS = ['Phone', 'Code', '2FA'];

// Progress indicator component
function StepIndicator({ currentStep }: { currentStep: Step }) {
    const stepIndex = currentStep === 'phone' ? 0
        : currentStep === 'code' ? 1
            : currentStep === '2fa' ? 2
                : currentStep === 'success' ? 3
                    : -1;

    return (
        <Box marginBottom={1}>
            {STEPS.map((step, i) => {
                const isActive = i === stepIndex;
                const isCompleted = i < stepIndex;
                return (
                    <Text key={step}>
                        <Text color={isActive ? theme.colors.primaryName : isCompleted ? 'green' : 'gray'}>
                            {isCompleted ? theme.icons.check : isActive ? theme.icons.connected : theme.icons.disconnected}
                        </Text>
                        <Text color={isActive ? theme.colors.primaryName : isCompleted ? 'green' : 'gray'}>
                            {' '}{step}
                        </Text>
                        {i < STEPS.length - 1 && (
                            <Text color="gray"> ─── </Text>
                        )}
                    </Text>
                );
            })}
        </Box>
    );
}

// Section header with gradient
function SectionHeader({ title }: { title: string }) {
    const width = 50;
    const dashes = '─'.repeat(Math.max(0, width - title.length - 4));
    return (
        <Box marginBottom={1}>
            <Gradient colors={['#FF9D00', '#FFAE00', '#FFC300']}>─ {title} {dashes}</Gradient>
        </Box>
    );
}

export function LoginScreen({ bridge, onSuccess, onError, onCancel }: Props) {
    const [step, setStep] = useState<Step>('phone');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [phoneCodeHash, setPhoneCodeHash] = useState<string | null>(null);
    const [accountId, setAccountId] = useState<string | null>(null);
    const [statusText, setStatusText] = useState('');
    const convex = useConvex();

    useEffect(() => {
        const saved = loadLoginState();
        if (!saved) return;
        setPhone(saved.phone);
        setAccountId(saved.accountId);
        setPhoneCodeHash(saved.phoneCodeHash);
        setStep(saved.step);
    }, []);

    const handlePhoneSubmit = useCallback(async () => {
        if (!convex) {
            onError('Database not connected. Cannot create account.');
            return;
        }
        if (!phone || phone.length < 10) {
            onError('Enter a valid phone with country code');
            return;
        }

        clearLoginState();

        setStep('loading');
        setStatusText('Sending verification code...');

        try {
            const convexAccountId = await convex.mutation(api.accounts.create, { phone });
            const result = await bridge.login(phone, convexAccountId as string);
            saveLoginState({
                phone,
                accountId: convexAccountId as string,
                phoneCodeHash: result.phone_code_hash,
                step: 'code',
                timestamp: Date.now(),
            });
            setPhoneCodeHash(result.phone_code_hash);
            setAccountId(convexAccountId as string);
            setStep('code');
            setStatusText('');
        } catch (e: any) {
            onError(e.message || 'Failed to send code');
            setStep('phone');
        }
    }, [phone, bridge, convex, onError]);

    const handleCodeSubmit = useCallback(async () => {
        if (!code || code.length < 5) {
            onError('Enter a valid verification code');
            return;
        }

        if (!phoneCodeHash || !accountId) {
            onError('Session expired, try again');
            setStep('phone');
            return;
        }

        setStep('loading');
        setStatusText('Verifying code...');

        try {
            const result = await bridge.verifyCode(accountId, phone, code, phoneCodeHash);

            if (result.needs_2fa) {
                saveLoginState({
                    phone,
                    accountId,
                    phoneCodeHash,
                    step: '2fa',
                    timestamp: Date.now(),
                });
                setStep('2fa');
                setStatusText('');
                return;
            }

            if (convex && result.session_string) {
                await convex.mutation(api.accounts.updateSession, {
                    accountId: accountId as any,
                    sessionString: result.session_string,
                    name: result.name,
                    username: result.username,
                });
            }

            clearLoginState();

            setStep('success');
            setTimeout(() => {
                onSuccess({
                    id: accountId,
                    phone,
                    name: result.name,
                    username: result.username,
                });
            }, 500);
        } catch (e: any) {
            onError(e.message || 'Failed to verify code');
            setStep('code');
        }
    }, [code, phoneCodeHash, accountId, phone, bridge, convex, onSuccess, onError]);

    const handle2FASubmit = useCallback(async () => {
        if (!password) {
            onError('Enter your 2FA password');
            return;
        }

        if (!phoneCodeHash || !accountId) {
            onError('Session expired, try again');
            setStep('phone');
            return;
        }

        setStep('loading');
        setStatusText('Verifying 2FA...');

        try {
            const result = await bridge.verifyCode(accountId, phone, code, phoneCodeHash, password);

            if (convex && result.session_string) {
                await convex.mutation(api.accounts.updateSession, {
                    accountId: accountId as any,
                    sessionString: result.session_string,
                    name: result.name,
                    username: result.username,
                });
            }

            clearLoginState();

            setStep('success');
            setTimeout(() => {
                onSuccess({
                    id: accountId,
                    phone,
                    name: result.name,
                    username: result.username,
                });
            }, 500);
        } catch (e: any) {
            onError(e.message || 'Invalid 2FA password');
            setStep('2fa');
        }
    }, [password, phoneCodeHash, accountId, phone, code, bridge, convex, onSuccess, onError]);

    useInput((input, key) => {
        if (key.escape && onCancel && step !== 'loading') {
            clearLoginState();
            onCancel();
            return;
        }
        if (key.return) {
            if (step === 'phone') handlePhoneSubmit();
            else if (step === 'code') handleCodeSubmit();
            else if (step === '2fa') handle2FASubmit();
        }
    });

    return (
        <Box flexDirection="column">
            {/* Header */}
            <Box marginBottom={1}>
                <Text bold color={theme.colors.primaryName}>Login to Telegram</Text>
            </Box>

            {/* Progress indicator */}
            {step !== 'loading' && step !== 'success' && (
                <StepIndicator currentStep={step} />
            )}

            {/* Phone input */}
            {step === 'phone' && (
                <Box flexDirection="column">
                    <SectionHeader title="Phone Number" />
                    <Box>
                        <Text color={theme.colors.primaryName}>+ </Text>
                        <TextInput
                            value={phone}
                            onChange={setPhone}
                            placeholder="1234567890"
                        />
                    </Box>
                    <Box marginTop={1}>
                        <Text color="gray">Include country code (e.g., 1 for US)</Text>
                    </Box>
                </Box>
            )}

            {/* Code input */}
            {step === 'code' && (
                <Box flexDirection="column">
                    <Box marginBottom={1}>
                        <Text color="green">{theme.icons.check} Code sent to +{phone}</Text>
                    </Box>
                    <SectionHeader title="Verification Code" />
                    <Box>
                        <TextInput
                            value={code}
                            onChange={setCode}
                            placeholder="12345"
                        />
                    </Box>
                </Box>
            )}

            {/* 2FA input */}
            {step === '2fa' && (
                <Box flexDirection="column">
                    <Box marginBottom={1}>
                        <Text color="yellow">Two-factor authentication required</Text>
                    </Box>
                    <SectionHeader title="2FA Password" />
                    <Box>
                        <TextInput
                            value={password}
                            onChange={setPassword}
                            mask="*"
                        />
                    </Box>
                </Box>
            )}

            {/* Loading */}
            {step === 'loading' && (
                <Box>
                    <Text color={theme.colors.primaryName}>
                        <Spinner type="dots" />
                    </Text>
                    <Text> {statusText}</Text>
                </Box>
            )}

            {/* Success */}
            {step === 'success' && (
                <Box>
                    <Text color="green">{theme.icons.check} Login successful!</Text>
                </Box>
            )}

            {/* Footer */}
            {step !== 'loading' && step !== 'success' && (
                <Box marginTop={2}>
                    <Text color="gray">
                        enter to continue {theme.icons.bullet} esc to cancel
                    </Text>
                </Box>
            )}
        </Box>
    );
}
