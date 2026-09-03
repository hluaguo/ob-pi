/**
 * Read-only CredentialStore over the user's existing pi auth file.
 *
 * The pi CLI stores credentials in `~/.pi/agent/auth.json`:
 *   { "<providerId>": { "type": "api_key", "key": "..." } | { "type": "oauth", ... } }
 *
 * By reusing that file, credentials configured once in the pi CLI
 * (`pi /login` or exported keys) work in Ob Pi with zero setup.
 * We never write to it from here — it stays owned by the pi CLI.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	Credential,
	CredentialStore,
	CredentialInfo,
	AuthOperationOptions,
} from "@earendil-works/pi-ai";

export const DEFAULT_PI_AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

type AuthFile = Record<string, Credential>;

export class PiAuthStore implements CredentialStore {
	private readonly authPath: string;

	constructor(authPath: string = DEFAULT_PI_AUTH_PATH) {
		this.authPath = authPath;
	}

	private async load(): Promise<AuthFile> {
		try {
			const raw = await readFile(this.authPath, "utf8");
			return JSON.parse(raw) as AuthFile;
		} catch {
			// Missing or unreadable file simply means "no stored credentials".
			return {};
		}
	}

	async read(
		providerId: string,
		_options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		const file = await this.load();
		return file[providerId];
	}

	async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		const file = await this.load();
		return Object.entries(file)
			.filter(([, credential]) => !!credential && typeof credential.type === "string")
			.map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}

	async modify(
		_providerId: string,
		_fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		_options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		throw new Error(
			`PiAuthStore is read-only (owned by the pi CLI at ${this.authPath}). ` +
				"Run `pi /login` or edit the auth file there.",
		);
	}

	async delete(_providerId: string, _options?: AuthOperationOptions): Promise<void> {
		throw new Error(`PiAuthStore is read-only (owned by the pi CLI at ${this.authPath}).`);
	}
}
