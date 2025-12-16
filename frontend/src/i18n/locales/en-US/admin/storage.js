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
      googledrive: "Google Drive storage",
      github_releases: "GitHub Releases",
      github_api: "GitHub API",
    },

    // group titles
    groups: {
      basic: "Basic settings",
      connection: "Connection",
      credentials: "Credentials",
      permissions: "Permissions",
      advanced: "Advanced options",
      options: "Options",
      behaviour: "Behaviour",
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

      // Google Drive specific
      googledrive: {
        use_online_api: "API Type",
        api_address: "Online API URL",
        client_id: "Client ID",
        client_secret: "Client secret",
        refresh_token: "Refresh token / Service Account JSON remote URL",
        root_id: "Root ID",
        enable_disk_usage: "Enable quota reading",
        enable_shared_view: "SharedWithMe view",
      },

      // GitHub Releases specific
      github_releases: {
        repo_structure: "Repository mapping rules",
        show_all_version: "Show all versions as directories",
        show_source_code: "Show Source code archives",
        show_readme: "Show README / LICENSE",
        show_release_notes: "Show Release Notes",
        per_page: "Releases per page",
        gh_proxy: "GitHub proxy URL",
        token: "GitHub access token",
      },

      // GitHub API (repository contents) specific
      github_api: {
        owner: "Repository owner",
        repo: "Repository name",
        ref: "Ref (branch/tag/sha)",
        api_base: "GitHub API base",
        gh_proxy: "GitHub proxy URL",
        committer_name: "Committer name (committer.name)",
        committer_email: "Committer email (committer.email)",
        author_name: "Author name (author.name)",
        author_email: "Author email (author.email)",
        token: "GitHub access token",
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

      // Google Drive placeholders
      googledrive: {
        api_address: "e.g., https://your-online-api.example.com/refresh",
        client_id: "Google OAuth client ID",
        client_secret: "Google OAuth client secret",
        refresh_token: "RefreshToken or remote URL to Service Account JSON",
        root_id: "e.g., root or a specific Shared Drive ID",
      },

      // GitHub Releases placeholders
      github_releases: {
        repo_structure:
          "One per line: owner/repo (single repo mounts at root), alias:owner/repo (required for multiple repos), or full repo URL (https://github.com/owner/repo), e.g., 2512132839/test, test:2512132839/test or https://github.com/2512132839/test",
        gh_proxy: "e.g., https://gh-proxy.com/https://github.com",
        token: "Recommended to set a personal access token to raise rate limits",
      },

      // GitHub API placeholders
      github_api: {
        owner: "e.g., ling-drag0n",
        repo: "e.g., CloudPaste",
        ref: "e.g., main, v1.0.0, or a 40-char commit sha (leave empty to use default branch)",
        api_base: "e.g., https://api.github.com (leave empty for default)",
        gh_proxy: "e.g., https://ghproxy.net/https://raw.githubusercontent.com (optional, affects direct links only)",
        committer_name: "e.g., CloudPaste Bot (optional)",
        committer_email: "{'e.g., bot@example.com (optional)'}",
        author_name: "e.g., Your Name (optional)",
        author_email: "{'e.g., you@example.com (optional)'}",
        token: "Required: token with repo read/write permission",
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

      // Google Drive descriptions
      googledrive: {
        use_online_api: "When enabled, use the Online API endpoint to obtain access tokens, suitable for centralized token services.",
        api_address: "Online API refresh address, call to obtain access_token and refresh_token.",
        client_id: "Client ID used in standard OAuth mode, created in GCP console.",
        client_secret: "Client secret used together with refresh_token to refresh access_token in standard OAuth mode.",
        refresh_token: "Supports two forms: 1) standard OAuth refresh_token; 2) remote Service Account JSON URL.",
        root_id: "Google Drive root folder ID, defaults to root; set to driveId when mounting a Shared Drive.",
        enable_disk_usage: "When enabled, get to fetch storage quota and usage information for display and quota analysis.",
        enable_shared_view: 'When enabled, a "Shared with me" virtual directory will be displayed under the corresponding mount root directory for browsing files shared with me',
      },

      // GitHub Releases descriptions
      github_releases: {
        repo_structure:
          "Configure GitHub repositories, one per line. Supported formats: owner/repo (recommended, the directory name uses repo) or alias:owner/repo (custom directory name). Example: ling-drag0n/CloudPaste or cloudpaste:ling-drag0n/CloudPaste. The mount path itself is defined in the mount configuration.",
        show_all_version:
          "When enabled, create a subdirectory for each release (named by tagName) and list assets under that directory. When disabled, only show assets from the latest release at the repo root.",
        show_source_code: 'When enabled, add virtual files "Source code (zip)" and "Source code (tar.gz)" for each release, pointing to GitHub provided source archives.',
        show_readme: "Mount README / LICENSE as virtual files at the repository root (when present in the repo). File content is fetched on demand via the GitHub API.",
        show_release_notes: "Add a virtual file RELEASE_NOTES.md under each release. Content is taken from the GitHub Release notes (Markdown).",
        per_page: "Number of releases to fetch per call from the GitHub Releases API. Default is 20. Larger values reduce API calls but increase response size.",
        gh_proxy:
          "Optional: Proxy prefix for accelerating GitHub downloads, e.g., fill in completely as https://gh-proxy.com/github.com or https://gh-proxy.com/https://github.com. Only effective for download links starting with https://github.com.",
        token: "Optional: GitHub personal access token. Used for private repositories or to increase API rate limits (strongly recommended for public-facing deployments).",
      },

      // GitHub API descriptions
      github_api: {
        owner: "GitHub repository owner (e.g., ling-drag0n).",
        repo: "GitHub repository name (e.g., CloudPaste).",
        ref: "Branch / tag / commit sha. Only branches support write; tags and commit sha are read-only. Leave empty to use the repository default branch.",
        api_base: "Optional: custom API(for GitHub Enterprise). Default is https://api.github.com.",
        gh_proxy: "Optional: accelerate raw direct links by replacing https://raw.githubusercontent.com with this value (direct-link output only).",
        committer_name: "Optional: commit committer.name (must be paired with committer_email).",
        committer_email: "Optional: commit committer.email (must be paired with committer_name).",
        author_name: "Optional: commit author.name (must be paired with author_email).",
        author_email: "Optional: commit author.email (must be paired with author_name).",
        token: "Required: GitHub access token for higher rate limits and write operations (create commits / update refs).",
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
      googledrive: {
        use_online_api: {
          enabled: "Online API",
          disabled: "Standard API",
        },
        enable_shared_view: {
          enabled: "enabled",
          disabled: "disabled",
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
