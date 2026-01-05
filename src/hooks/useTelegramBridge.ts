import { spawn, ChildProcess } from 'child_process';
import { useRef, useEffect, useMemo } from 'react';
import { createInterface, Interface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export function useTelegramBridge(): TelegramBridge {
    const processRef = useRef<ChildProcess | null>(null);
    const rlRef = useRef<Interface | null>(null);
    const pendingRef = useRef<Map<number, { resolve: Function; reject: Function }>>(new Map());
    const idRef = useRef(0);
    const notificationCallbackRef = useRef<((notification: any) => void) | null>(null);
    const startedRef = useRef(false);

    useEffect(() => {
        if (startedRef.current) return;
        startedRef.current = true;

        // Path to Python service
        const pythonScript = path.resolve(__dirname, '../../python/telegram_service.py');

        // Spawn Python process
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
            if (code !== 0 && code !== null) {
                console.error(`Python process exited with code ${code}`);
            }
        });

        // Set up readline for stdout
        if (proc.stdout) {
            const rl = createInterface({ input: proc.stdout });
            rlRef.current = rl;

            rl.on('line', (line) => {
                try {
                    const response = JSON.parse(line);

                    // Handle notifications (no id field)
                    if (response.method === 'notification' && notificationCallbackRef.current) {
                        notificationCallbackRef.current(response.params);
                        return;
                    }

                    // Handle RPC responses
                    const pending = pendingRef.current.get(response.id);
                    if (pending) {
                        pendingRef.current.delete(response.id);
                        if (response.error) {
                            pending.reject(new Error(response.error.message));
                        } else {
                            pending.resolve(response.result);
                        }
                    }
                } catch (e) {
                    // Ignore parse errors for non-JSON output
                }
            });
        }

        return () => {
            if (rlRef.current) {
                rlRef.current.close();
            }
            if (processRef.current) {
                processRef.current.kill();
            }
        };
    }, []);

    const call = async (method: string, params: Record<string, any> = {}): Promise<any> => {
        return new Promise((resolve, reject) => {
            const id = ++idRef.current;
            const request = JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';

            pendingRef.current.set(id, { resolve, reject });

            if (processRef.current?.stdin) {
                processRef.current.stdin.write(request);
            } else {
                reject(new Error('Python process not started'));
            }

            // Timeout after 60 seconds
            setTimeout(() => {
                if (pendingRef.current.has(id)) {
                    pendingRef.current.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 60000);
        });
    };

    const cleanup = () => {
        if (rlRef.current) {
            rlRef.current.close();
            rlRef.current = null;
        }
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
