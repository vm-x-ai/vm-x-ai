export const ENCRYPTION_SERVICE = 'ENCRYPTION_SERVICE';

export interface IEncryptionService {
  encrypt(plaintext: string, context?: Record<string, string>): Promise<string>;
  decrypt(ciphertext: string, context?: Record<string, string>): Promise<string>;
}

export abstract class EncryptionServiceBase implements IEncryptionService {
  abstract encrypt(plaintext: string, context?: Record<string, string>): Promise<string>;
  abstract decrypt(ciphertext: string, context?: Record<string, string>): Promise<string>;
}
