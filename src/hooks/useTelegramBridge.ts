import { spawn, ChildProcess } from 'child_process';
import { useRef, useEffect, useMemo, useCallback } from 'react';
import { createInterface, Interface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_RESTART_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1000;

export interface TelegramBridge {
    login: (phone: string, accountId: string) => Promise<any>;
    verifyCode: (
        accountId: string,
        phone: string,
        code: string,
        phoneCodeHash: string,
        password?: string
    ) => Promise<any>;
    connectWithSession: (accountId: string, sessionString: string) => Promise<any>;
    disconnect: (accountId: string) => Promise<any>;
    getDialogs: (accountId: string, limit?: number) => Promise<any[]>;
    fetchMessages: (accountId: string, peerId: string, limit?: number) => Promise<any[]>;
    sendMessage: (
        accountId: string,
        peerId: string,
        text: string,
        replyTo?: number
    ) => Promise<any>;
    ping: () => Promise<any>;
    cleanup: () => void;
    onNotification: (callback: (notification: any) => void) => void;
}

type PendingEntry = {
    resolve: Function;
    reject: Function;
    timeoutId: ReturnType<typeof setTimeout>;
};

export function useTelegramBridge(): TelegramBridge {
    const processRef = useRef<ChildProcess | null>(null);
    const rlRef = useRef<Interface | null>(null);
    const pendingRef = useRef<Map<number, PendingEntry>>(new Map());
    const idRef = useRef(0);
    const notificationCallbackRef = useRef<((notification: any) => void) | null>(null);
    const startedRef = useRef(false);
    const stopRequestedRef = useRef(false);
    const restartAttemptsRef = useRef(0);
    const backoffRef = useRef(INITIAL_BACKOFF_MS);
    const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const closeReadline = () => {
        if (rlRef.current) {
            rlRef.current.close();
            rlRef.current = null;
        }
    };

    const rejectAllPending = (error: string) => {
        pendingRef.current.forEach(({ reject, timeoutId }) => {
            clearTimeout(timeoutId);
            reject(new Error(error));
        });
        pendingRef.current.clear();
    };

    const startPythonProcess = useCallback(() => {
        const pythonScript = path.resolve(__dirname, '../../python/telegram_service.py');

        const proc = spawn('python', [pythonScript], {
            stdio: ['pipe', 'pipe', 'inherit'],
            env: { ...process.env },
            cwd: path.resolve(__dirname, '../..'),
        });

        processRef.current = proc;

        proc.on('error', (err) => {
            console.error('Failed to start Python process:', err.message);
        });

        proc.on('exit', (code) => {
            closeReadline();
            processRef.current = null;

            if (stopRequestedRef.current) return;

            if (code !== 0 && code !== null) {
                rejectAllPending('Python process crashed');

                notificationCallbackRef.current?.({
                    type: 'error',
                    message: 'Backend disconnected, attempting reconnect...',
                });

                if (restartAttemptsRef.current < MAX_RESTART_ATTEMPTS) {
                    restartAttemptsRef.current++;
                    const delay = backoffRef.current;
                    restartTimeoutRef.current = setTimeout(() => {
                        if (stopRequestedRef.current) return;
                        startPythonProcess();
                        backoffRef.current = Math.min(backoffRef.current * 2, 30000);
                    }, delay);
                } else {
                    notificationCallbackRef.current?.({
                        type: 'error',
                        message: 'Failed to restart backend after 5 attempts',
                    });
                }
            }
        });

        if (proc.stdout) {
            const rl = createInterface({ input: proc.stdout });
            rlRef.current = rl;

            rl.on('line', (line) => {
                try {
                    const response = JSON.parse(line);

                    if (restartAttemptsRef.current !== 0) {
                        restartAttemptsRef.current = 0;
                        backoffRef.current = INITIAL_BACKOFF_MS;
                    }

                    if (response.method === 'notification' && notificationCallbackRef.current) {
                        notificationCallbackRef.current(response.params);
                        return;
                    }

                    const pending = pendingRef.current.get(response.id);
                    if (pending) {
                        clearTimeout(pending.timeoutId);
                        pendingRef.current.delete(response.id);
                        if (response.error) {
                            pending.reject(new Error(response.error.message));
                        } else {
                            pending.resolve(response.result);
                        }
                    }
                } catch {
                    return;
                }
            });
        }

        return proc;
    }, []);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        stopRequestedRef.current = false;
        startPythonProcess();

        return () => {
            stopRequestedRef.current = true;
            if (restartTimeoutRef.current) {
                clearTimeout(restartTimeoutRef.current);
                restartTimeoutRef.current = null;
            }
            rejectAllPending('Bridge closed');
            closeReadline();
            if (processRef.current) {
                processRef.current.kill();
                processRef.current = null;
            }
        };
    }, [startPythonProcess]);

    const call = async (method: string, params: Record<string, any> = {}): Promise<any> => {
        return new Promise((resolve, reject) => {
            const id = ++idRef.current;
            const request = JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';

            const timeoutId = setTimeout(() => {
                if (pendingRef.current.has(id)) {
                    pendingRef.current.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 15000);

            pendingRef.current.set(id, { resolve, reject, timeoutId });

            if (processRef.current?.stdin) {
                processRef.current.stdin.write(request);
            } else {
                clearTimeout(timeoutId);
                pendingRef.current.delete(id);
                reject(new Error('Python process not started'));
            }
        });
    };

    const cleanup = () => {
        stopRequestedRef.current = true;
        if (restartTimeoutRef.current) {
            clearTimeout(restartTimeoutRef.current);
            restartTimeoutRef.current = null;
        }
        rejectAllPending('Bridge closed');
        closeReadline();
        if (processRef.current) {
            processRef.current.kill();
            processRef.current = null;
        }
    };

    const onNotification = (callback: (notification: any) => void) => {
        notificationCallbackRef.current = callback;
    };

    return useMemo(
        () => ({
            login: (phone: string, accountId: string) =>
                call('login', { phone, account_id: accountId }),
            verifyCode: (
                accountId: string,
                phone: string,
                code: string,
                phoneCodeHash: string,
                password?: string
            ) =>
                call('verify_code', {
                    account_id: accountId,
                    phone,
                    code,
                    phone_code_hash: phoneCodeHash,
                    password,
                }),
            connectWithSession: (accountId: string, sessionString: string) =>
                call('connect_with_session', {
                    account_id: accountId,
                    session_string: sessionString,
                }),
            disconnect: (accountId: string) => call('disconnect', { account_id: accountId }),
            getDialogs: (accountId: string, limit?: number) =>
                call('get_dialogs', { account_id: accountId, limit }),
            fetchMessages: (accountId: string, peerId: string, limit?: number) =>
                call('fetch_messages', {
                    account_id: accountId,
                    peer_id: peerId,
                    limit,
                }),
            sendMessage: (accountId: string, peerId: string, text: string, replyTo?: number) =>
                call('send_message', {
                    account_id: accountId,
                    peer_id: peerId,
                    text,
                    reply_to: replyTo,
                }),
            ping: () => call('ping'),
            cleanup,
            onNotification,
        }),
        []
    );
}
