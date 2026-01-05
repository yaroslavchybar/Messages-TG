import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import { TelegramBridge } from '../hooks/useTelegramBridge';
import { useConvex } from '../context/ConvexContext';
import { api } from '../../convex/_generated/api';

type Step = 'phone' | 'code' | '2fa' | 'loading' | 'success';

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

export function LoginScreen({ bridge, onSuccess, onError, onCancel }: Props) {
    const [step, setStep] = useState<Step>('phone');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [phoneCodeHash, setPhoneCodeHash] = useState<string | null>(null);
    const [accountId, setAccountId] = useState<string | null>(null);
    const [statusText, setStatusText] = useState('');
    const convex = useConvex();

    const handlePhoneSubmit = useCallback(async () => {
        if (!phone || phone.length < 10) {
            onError('Please enter a valid phone number with country code');
            return;
        }

        setStep('loading');
        setStatusText('Sending verification code...');

        try {
            // Create or get account in Convex
            const convexAccountId = await convex?.mutation(api.accounts.create, { phone });

            // Start Telegram login
            const result = await bridge.login(phone, convexAccountId as string);

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
            onError('Please enter a valid verification code');
            return;
        }

        if (!phoneCodeHash || !accountId) {
            onError('Session expired, please try again');
            setStep('phone');
            return;
        }

        setStep('loading');
        setStatusText('Verifying code...');

        try {
            const result = await bridge.verifyCode(accountId, phone, code, phoneCodeHash);

            if (result.needs_2fa) {
                setStep('2fa');
                setStatusText('');
                return;
            }

            // Update session in Convex
            if (convex && result.session_string) {
                await convex.mutation(api.accounts.updateSession, {
                    accountId: accountId as any,
                    sessionString: result.session_string,
                    name: result.name,
                    username: result.username,
                });
            }

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
            onError('Please enter your 2FA password');
            return;
        }

        if (!phoneCodeHash || !accountId) {
            onError('Session expired, please try again');
            setStep('phone');
            return;
        }

        setStep('loading');
        setStatusText('Verifying 2FA...');

        try {
            const result = await bridge.verifyCode(accountId, phone, code, phoneCodeHash, password);

            // Update session in Convex
            if (convex && result.session_string) {
                await convex.mutation(api.accounts.updateSession, {
                    accountId: accountId as any,
                    sessionString: result.session_string,
                    name: result.name,
                    username: result.username,
                });
            }

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
            <Box marginBottom={1}>
                <Text bold>🔐 Login to Telegram</Text>
            </Box>

            {/* Phone input */}
            {step === 'phone' && (
                <Box flexDirection="column">
                    <Box>
                        <Text>Phone number (with country code): </Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="cyan">+</Text>
                        <TextInput
                            value={phone}
                            onChange={setPhone}
                            placeholder="1234567890"
                        />
                    </Box>
                    <Box marginTop={1}>
                        <Text dimColor>Press Enter to continue</Text>
                    </Box>
                </Box>
            )}

            {/* Verification code input */}
            {step === 'code' && (
                <Box flexDirection="column">
                    <Box>
                        <Text color="green">✓ Code sent to {phone}</Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text>Verification code: </Text>
                    </Box>
                    <Box marginTop={1}>
                        <TextInput
                            value={code}
                            onChange={setCode}
                            placeholder="12345"
                        />
                    </Box>
                    <Box marginTop={1}>
                        <Text dimColor>Press Enter to verify</Text>
                    </Box>
                </Box>
            )}

            {/* 2FA password input */}
            {step === '2fa' && (
                <Box flexDirection="column">
                    <Box>
                        <Text color="yellow">⚠ Two-factor authentication required</Text>
                    </Box>
                    <Box marginTop={1}>
                        <Text>2FA Password: </Text>
                    </Box>
                    <Box marginTop={1}>
                        <TextInput
                            value={password}
                            onChange={setPassword}
                            mask="*"
                        />
                    </Box>
                    <Box marginTop={1}>
                        <Text dimColor>Press Enter to continue</Text>
                    </Box>
                </Box>
            )}

            {/* Loading state */}
            {step === 'loading' && (
                <Box marginTop={1}>
                    <Text color="cyan">
                        <Spinner type="dots" />
                    </Text>
                    <Text> {statusText}</Text>
                </Box>
            )}

            {/* Success state */}
            {step === 'success' && (
                <Box marginTop={1}>
                    <Text color="green">✓ Login successful! Loading conversations...</Text>
                </Box>
            )}
        </Box>
    );
}
