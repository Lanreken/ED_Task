import { createSign } from 'node:crypto';

type JwtTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

export type GoogleDriveClientConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
  scope: string;
  folderId?: string;
  folderName: string;
};

export type DriveSnapshotFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
};

function base64UrlJson(input: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function normalizePrivateKey(key: string) {
  return key.includes('BEGIN PRIVATE KEY') ? key : key.replace(/\\n/g, '\n');
}

export class GoogleDriveClient {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private cachedFolderId: string | null = null;

  constructor(private readonly config: GoogleDriveClientConfig) {}

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
    const payload = base64UrlJson({
      iss: this.config.clientEmail,
      scope: this.config.scope,
      aud: this.config.tokenUri,
      iat: now,
      exp: now + 3600,
    });

    const unsignedToken = `${header}.${payload}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsignedToken);
    signer.end();

    const signature = signer.sign(normalizePrivateKey(this.config.privateKey), 'base64url');
    const assertion = `${unsignedToken}.${signature}`;

    const form = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });

    const response = await fetch(this.config.tokenUri, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!response.ok) {
      throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as JwtTokenResponse;
    this.accessToken = json.access_token;
    this.accessTokenExpiresAt = Date.now() + json.expires_in * 1000;
    return this.accessToken;
  }

  private async authorizedFetch(url: string, init: RequestInit = {}) {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${token}`);
    return fetch(url, {
      ...init,
      headers,
    });
  }

  async ensureFolder(): Promise<string> {
    if (this.cachedFolderId) {
      return this.cachedFolderId;
    }

    if (this.config.folderId) {
      this.cachedFolderId = this.config.folderId;
      return this.cachedFolderId;
    }

    const query = new URLSearchParams({
      q: `mimeType='application/vnd.google-apps.folder' and name='${this.config.folderName}' and trashed=false`,
      fields: 'files(id,name)',
      spaces: 'drive',
      pageSize: '1',
      supportsAllDrives: 'true',
    });

    const lookup = await this.authorizedFetch(`https://www.googleapis.com/drive/v3/files?${query.toString()}`);
    if (!lookup.ok) {
      throw new Error(`Google Drive folder lookup failed: ${lookup.status} ${await lookup.text()}`);
    }

    const lookupJson = await lookup.json() as { files?: DriveSnapshotFile[] };
    const existing = lookupJson.files?.[0];
    if (existing?.id) {
      this.cachedFolderId = existing.id;
      return existing.id;
    }

    const createResponse = await this.authorizedFetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: this.config.folderName,
        mimeType: 'application/vnd.google-apps.folder',
      }),
    });

    if (!createResponse.ok) {
      throw new Error(`Google Drive folder creation failed: ${createResponse.status} ${await createResponse.text()}`);
    }

    const created = await createResponse.json() as DriveSnapshotFile;
    this.cachedFolderId = created.id;
    return created.id;
  }

  async uploadJsonSnapshot(input: {
    fileName: string;
    content: unknown;
    appProperties?: Record<string, string>;
  }) {
    const folderId = await this.ensureFolder();
    const metadataResponse = await this.authorizedFetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: input.fileName,
        mimeType: 'application/json',
        parents: [folderId],
        appProperties: input.appProperties ?? {},
      }),
    });

    if (!metadataResponse.ok) {
      throw new Error(`Google Drive file creation failed: ${metadataResponse.status} ${await metadataResponse.text()}`);
    }

    const metadata = await metadataResponse.json() as DriveSnapshotFile;
    const uploadResponse = await this.authorizedFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${metadata.id}?uploadType=media&supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(input.content, null, 2),
      },
    );

    if (!uploadResponse.ok) {
      throw new Error(`Google Drive file upload failed: ${uploadResponse.status} ${await uploadResponse.text()}`);
    }

    const uploaded = await uploadResponse.json() as DriveSnapshotFile;
    return {
      fileId: uploaded.id,
      name: input.fileName,
    };
  }

  async listSnapshots() {
    const folderId = await this.ensureFolder();
    const query = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`,
      orderBy: 'createdTime desc',
      fields: 'files(id,name,mimeType,createdTime,modifiedTime)',
      pageSize: '20',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });

    const response = await this.authorizedFetch(`https://www.googleapis.com/drive/v3/files?${query.toString()}`);
    if (!response.ok) {
      throw new Error(`Google Drive list failed: ${response.status} ${await response.text()}`);
    }

    const json = await response.json() as { files?: DriveSnapshotFile[] };
    return json.files ?? [];
  }

  async downloadSnapshot(fileId: string) {
    const response = await this.authorizedFetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`,
    );

    if (!response.ok) {
      throw new Error(`Google Drive download failed: ${response.status} ${await response.text()}`);
    }

    return response.json();
  }
}
