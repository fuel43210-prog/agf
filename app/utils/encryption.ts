import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const DEFAULT_ENCRYPTION_KEY = 'default-32-byte-key-placeholder-32';
const NODE_ENV = process.env.NODE_ENV || 'development';
let warnedInsecureEncryptionKey = false;
let keyCache: Buffer | null = null;

function resolveEncryptionKey(): string {
    const encryptionKeyFromEnv = String(process.env.ENCRYPTION_KEY || '').trim();
    const encryptionKeyIsInsecure =
        !encryptionKeyFromEnv || encryptionKeyFromEnv === DEFAULT_ENCRYPTION_KEY;

    if (encryptionKeyIsInsecure && NODE_ENV === 'production') {
        console.error(`[Encryption] Critical: ENCRYPTION_KEY is ${!encryptionKeyFromEnv ? 'missing/empty' : 'set to default insecure value'} in production environment.`);
        throw new Error('ENCRYPTION_KEY is missing or insecure in production. Set a strong ENCRYPTION_KEY env var.');
    }

    if (encryptionKeyIsInsecure && NODE_ENV !== 'production' && !warnedInsecureEncryptionKey) {
        warnedInsecureEncryptionKey = true;
        console.warn('ENCRYPTION_KEY is missing/insecure for development. Set ENCRYPTION_KEY to protect local data.');
    }

    return encryptionKeyFromEnv || DEFAULT_ENCRYPTION_KEY;
}

function getKey(): Buffer {
    if (keyCache) return keyCache;
    const encryptionKey = resolveEncryptionKey();
    // Ensure the key is exactly 32 bytes for AES-256-CBC
    keyCache = crypto.createHash('sha256').update(String(encryptionKey)).digest();
    return keyCache;
}
const IV_LENGTH = 16;

export function encrypt(text: string): string {
    if (!text) return '';
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text: string): string {
    if (!text) return '';
    try {
        const textParts = text.split(':');
        if (textParts.length < 2) {
            console.error('Invalid encrypted text format: missing IV separator.');
            return '';
        }
        const iv = Buffer.from(textParts.shift()!, 'hex');
        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (error) {
        console.error('Decryption failed. The input may be malformed or the key may have changed.', error);
        return ''; // Fail gracefully instead of crashing
    }
}

export function maskValue(value: string, visibleSuffixLen: number = 4): string {
    if (!value) return '';
    if (value.length <= visibleSuffixLen) return value;
    const maskedLength = value.length - visibleSuffixLen;
    return 'X'.repeat(maskedLength) + value.slice(-visibleSuffixLen);
}
