export default {
  storage: {
    // generic
    item: "this storage config",

    // storage type labels
    type: {
      s3: "S3 compatible storage",
      webdav: "WebDAV storage",
      local: "Local file system",
      onedrive: "OneDrive storage",
    },

    // group titles
    groups: {
      basic: "Basic settings",
      connection: "Connection",
      credentials: "Credentials",
      permissions: "Permissions",
      advanced: "Advanced options",
      options: "Options",
    },

    // field labels
    fields: {
      name: "Config name",
      storage_type: "Storage type",
      provider_type: "Provider",
      endpoint_url: "Endpoint URL",
      bucket_name: "Bucket name",
      region: "Region",
      access_key_id: "Access key ID",
      secret_access_key: "Secret access key",
      path_style: "Path style",
      default_folder: "Default upload folder",
      custom_host: "Custom host",
      url_proxy: "Proxy URL",
      signature_expires_in: "Signature TTL (seconds)",
      is_public: "Visible to API keys",
      username: "Username",
      password: "Password",
      tls_insecure_skip_verify: "Skip TLS verification",

      // LOCAL specific
      local: {
        root_path: "Local root path",
        readonly: "Read-only mode",
      },

      // OneDrive specific
      onedrive: {
        region: "Region",
        client_id: "Client ID",
        client_secret: "Client secret",
        refresh_token: "Refresh token",
        token_renew_endpoint: "Token renew endpoint",
        redirect_uri: "Redirect URI",
        use_online_api: "API Type",
        oauth_status: "OAuth Status",
      },
    },

    // placeholder texts
    placeholder: {
      bucket_name: "e.g., my-bucket",
      endpoint_url: "e.g., https://s3.region.amazonaws.com",
      region: "e.g., us-east-1 or leave empty",
      access_key_id: "Enter access key ID",
      secret_access_key: "Enter secret access key",
      default_folder: "e.g., uploads/ or leave empty to upload to root",
      custom_host: "e.g., https://cdn.example.com",
      url_proxy: "e.g., https://proxy.example.com",
      webdav_endpoint: "e.g., https://dav.example.com/dav",
      username: "Enter WebDAV username",
      password: "Enter WebDAV password",
      root_path: "e.g., /data/storage or D:\\Storage",

      // OneDrive placeholders
      onedrive: {
        client_id: "Azure app client ID",
        client_secret: "Azure app client secret",
        refresh_token: "Refresh token from external OAuth page",
        token_renew_endpoint: "e.g., https://your-token-service.com/renew",
        redirect_uri: "e.g., https://your-token-service.com/onedrive/callback",
      },
    },

    // description texts
    description: {
      endpoint_url: "The endpoint URL for S3-compatible service, format varies by provider",
      path_style: "Enable path-style (endpoint/bucket) access, disable for virtual-host style (bucket.endpoint)",
      signature_expires_in: "Presigned URL validity period in seconds, default 3600",
      custom_host: "Custom domain for public access links (e.g., CDN acceleration)",
      url_proxy: "Access storage through a proxy server for relay scenarios",
      webdav_endpoint: "Full access URL for the WebDAV service",
      tls_insecure_skip_verify: "Skip TLS certificate verification (insecure, for testing only)",
      root_path: "Root directory path for local file storage, must be an absolute path",
      readonly: "Enable read-only mode, disabling write and delete operations",

      // OneDrive descriptions
      onedrive: {
        region: "Select OneDrive service region, choose Global for international version, CN for 21Vianet version",
        client_id: "Client ID obtained after registering the application in Azure Portal",
        client_secret: "Client secret of the Azure application",
        refresh_token: "Recommended to complete authorization on external authorization sites such as OpenList APIPages, then copy the refresh token and paste it here",
        root_folder: "Default upload directory path in OneDrive, leave blank to use the entire OneDrive",
        token_renew_endpoint: "Optional: Custom token renewal service address, used for connecting to external renewal services such as Online API",
        redirect_uri: "Callback address configured in the Azure application for the external authorization site, usually consistent with the authorization page documentation",
        use_online_api: "When enabled, CloudPaste will call the renewal endpoint to refresh the token according to the Online API protocol",
      },
    },

    // card summary display values
    display: {
      path_style: {
        path: "Path style",
        virtual_host: "Virtual host style",
      },
      default_folder: {
        root: "Root",
      },
      onedrive: {
        use_online_api: {
          enabled: "Online API",
          disabled: "Standard API",
        },
        oauth_status: {
          authorized: "✅ Authorized",
          missing: "⚠️ Not configured",
        },
      },
    },

    s3: {
      provider: {
        cloudflare_r2: "Cloudflare R2",
        backblaze_b2: "Backblaze B2",
        aws_s3: "AWS S3",
        aliyun_oss: "Aliyun OSS",
        other: "Other S3-compatible service",
      },
    },

    // OneDrive region options
    onedrive: {
      region: {
        global: "Global (International)",
        cn: "China (21Vianet)",
        us: "US Government",
        de: "Germany",
      },
    },
  },
};
