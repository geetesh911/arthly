// SPDX-License-Identifier: AGPL-3.0-only
// Fingerprint or Face ID unlock: a WebAuthn passkey with the PRF extension gives a secret that
// never leaves the device's authenticator. Browsers without PRF don't offer this option.

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function passkeysSupported(): Promise<boolean> {
  if (!window.PublicKeyCredential) {
    return false;
  }

  try {
    const caps = await (
      PublicKeyCredential as unknown as {
        getClientCapabilities?: () => Promise<Record<string, boolean>>;
      }
    ).getClientCapabilities?.();

    if (caps && 'extension:prf' in caps) {
      return !!caps['extension:prf'];
    }

    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

async function evaluate(credentialId: string, prfSalt: string): Promise<Uint8Array> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId) }],
      userVerification: 'required',
      extensions: {
        prf: { eval: { first: fromB64url(prfSalt) } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  const first = (assertion?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results
    ?.first;

  if (!first) {
    throw new Error("This device's passkey can't unlock the vault");
  }

  return new Uint8Array(first);
}

/** Creates a passkey for this vault and returns what the keyring needs. */
export async function enrolPasskey(
  vaultName: string,
): Promise<{ credentialId: string; prfSalt: string; prfOutput: Uint8Array }> {
  const prfSalt = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Arthly', id: location.hostname },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: vaultName,
        displayName: vaultName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      extensions: {
        prf: { eval: { first: fromB64url(prfSalt) } },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('No passkey was created');
  }

  const credentialId = b64url(credential.rawId);
  const results = credential.getClientExtensionResults() as PrfResults;

  if (results.prf?.enabled === false) {
    throw new Error("This device's passkeys don't support unlocking");
  }

  // Some browsers only give the PRF output when the passkey is used, not when it's made.
  const prfOutput = results.prf?.results?.first
    ? new Uint8Array(results.prf.results.first)
    : await evaluate(credentialId, prfSalt);

  return { credentialId, prfSalt, prfOutput };
}

export async function usePasskey(
  passkeys: { credentialId: string; prfSalt: string }[],
): Promise<{ credentialId: string; prfOutput: Uint8Array }> {
  let last: unknown;

  for (const p of passkeys) {
    try {
      return { credentialId: p.credentialId, prfOutput: await evaluate(p.credentialId, p.prfSalt) };
    } catch (error) {
      last = error;
    }
  }

  throw last ?? new Error('No passkey on this device');
}
