import { textToHex } from "../utils/hex";

export function signerMetadataDatum(
  nickName: string,
  realName: string,
  contactInfo: string,
  additionalInfo: string,
) {
  return {
    alternative: 0,
    fields: [
      textToHex(nickName),
      textToHex(realName),
      textToHex(contactInfo),
      textToHex(additionalInfo),
    ],
  };
}

export function attestationDatum(
  originalAuthor: string,
  description: string,
  sourceCode: string,
  scriptHash: string,
  scriptAddress: string,
  stakingPolicy: string,
  mintingPolicy: string,
) {
  return {
    alternative: 0,
    fields: [
      originalAuthor,
      textToHex(description),
      textToHex(sourceCode),
      scriptHash,
      textToHex(scriptAddress),
      stakingPolicy,
      mintingPolicy,
    ],
  };
}
