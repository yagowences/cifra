/** Erro comum a qualquer provedor: chave ausente, inválida, ou sobrecarregado. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}
