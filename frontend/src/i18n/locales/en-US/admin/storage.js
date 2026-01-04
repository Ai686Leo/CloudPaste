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
      telegram: "Telegram Bot API",
      discord: "Discord Bot API",
      huggingface_datasets: "HuggingFace Datasets",
      mirror: "Source Mirror",
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

      // S3 specific
      s3: {
        multipart_part_size_mb: "Multipart part size (MB)",
        multipart_concurrency: "Multipart concurrency",
      },

      // LOCAL specific
      local: {
        root_path: "Local root path",
        readonly: "Read-only mode",
        enable_disk_usage: "Enable quota reading",
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
        enable_disk_usage: "Enable quota reading",
        oauth_status: "OAuth Status",
      },

      // Google Drive specific
      googledrive: {
        use_online_api: "API Type",
        endpoint_url: "Token renew endpoint",
        client_id: "Client ID",
        client_secret: "Client secret",
        refresh_token: "Refresh token / Service Account JSON remote URL",
        root_id: "Root ID",
        enable_disk_usage: "Enable quota reading",
        enable_shared_view: "SharedWithMe view",
      },

      // WebDAV specific (quota toggle)
      webdav: {
        enable_disk_usage: "Enable quota reading",
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
        endpoint_url: "GitHub API base",
        gh_proxy: "GitHub proxy URL",
        committer_name: "Committer name (committer.name)",
        committer_email: "Committer email (committer.email)",
        author_name: "Author name (author.name)",
        author_email: "Author email (author.email)",
        token: "GitHub access token",
      },

      // Telegram specific
      telegram: {
        bot_token: "Bot token",
        target_chat_id: "Target chat ID",
        endpoint_url: "Bot API base URL",
        bot_api_mode: "Bot API mode",
        part_size_mb: "Chunk size (MB)",
        upload_concurrency: "Upload concurrency",
        verify_after_upload: "Verify after upload",
      },

      // Discord specific
      discord: {
        bot_token: "Bot token",
        channel_id: "Channel ID",
        endpoint_url: "API base URL (optional)",
        part_size_mb: "Chunk size (MB)",
        upload_concurrency: "Upload concurrency",
      },

      // HuggingFace Datasets specific
      huggingface_datasets: {
        repo: "Dataset repository (repo)",
        revision: "Branch/version (revision)",
        endpoint_url: "Hub address (optional)",
        hf_token: "HF Token (optional)",
        hf_use_paths_info: "Show more info (modification time / Xet / LFS)",
        hf_tree_limit: "Entries per page (tree limit)",
        hf_multipart_concurrency: "Multipart concurrency",
        hf_use_xet: "Use Xet storage backend (disabled by default)",
        hf_delete_lfs_on_remove: "Also delete HuggingFace LFS objects on remove (careful)",
      },

      // MIRROR (mirror site)
      mirror: {
        preset: "Mirror preset",
        endpoint_url: "Mirror base URL",
        max_entries: "Max entries",
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
        endpoint_url: "e.g., https://your-online-api.example.com/refresh",
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
        endpoint_url: "e.g., https://api.github.com (leave empty for default)",
        gh_proxy: "e.g., https://ghproxy.net/https://raw.githubusercontent.com (optional, affects direct links only)",
        committer_name: "e.g., CloudPaste Bot (optional)",
        committer_email: "{'e.g., bot@example.com (optional)'}",
        author_name: "e.g., Your Name (optional)",
        author_email: "{'e.g., you@example.com (optional)'}",
        token: "Required: token with repo read/write permission",
      },

      telegram: {
        bot_token: "Paste the token from ＠BotFather (e.g., 123:ABC...)",
        target_chat_id: "e.g., -100xxxxxxxxxx (numbers only)",
        bot_api_mode: "Default: official",
        endpoint_url: "e.g., https://api.telegram.org (set to your own Bot API server when self-hosted)",
        part_size_mb: "Default 15; recommended ≤ 20 when not self-hosted; no limit when self-hosted",
        upload_concurrency: "Default 2; higher is faster but easier to hit rate limits",
      },

      discord: {
        bot_token: "Paste Discord Bot Token",
        channel_id: "Target channel's Channel ID",
        endpoint_url: "e.g., https://discord.com/api/v10 (default official; change only when using a proxy/reverse-proxy)",
        part_size_mb: "Default 10; recommended 8~10 (Discord upload limit is max 10MB per upload, 25MB for Nitro users)",
        upload_concurrency: "Default 1; increasing this speeds up uploads but may trigger Discord rate limits more easily",
      },

      huggingface_datasets: {
        repo: "e.g., Open-Orca/OpenOrca (do not write the full URL)",
        revision: "e.g., main (branch name); tags/commits can also be used, but they are read-only",
        endpoint_url: "default https://huggingface.co; only change for self-hosted mirrors/proxies",
        hf_token: "optional: create at https://huggingface.co/settings/tokens; required for private/gated repos",
        hf_tree_limit: "default 100; higher values return more data per request",
        hf_multipart_concurrency: "default 5; higher is faster but can be less stable",
      },

      mirror: {
        endpoint_url: "e.g., https://mirrors.tuna.tsinghua.edu.cn/",
        max_entries: "e.g., 1000",
      },
    },

    // enum options
    enum: {
      mirror: {
        preset: {
          tuna: "Tsinghua",
          ustc: "USTC",
          aliyun: "Aliyun",
        },
      },
      telegram: {
        bot_api_mode: {
          official: "Official (api.telegram.org)",
          self_hosted: "Self-hosted Bot API server",
        },
      },
    },

    // toggle label (for a more natural checkbox UX)
    toggle: {
      telegram: {
        bot_api_mode: "Use self-hosted Bot API server",
      },
    },

    // description texts
    description: {
      endpoint_url: "The endpoint URL for S3-compatible service, format varies by provider",
      path_style: "Enable path-style (endpoint/bucket) access, disable for virtual-host style (bucket.endpoint)",
      signature_expires_in: "Presigned URL validity period in seconds, default 3600",
      custom_host: "Custom domain for public access links (e.g., CDN acceleration)",
      url_proxy: "Access storage through a proxy server for relay scenarios",
      s3: {
        multipart_part_size_mb: "Multipart part size (MB) for browser direct-upload. Default 5MB; larger parts mean fewer parts but higher cost to retry a failed part.",
        multipart_concurrency: "How many parts to upload at the same time for browser direct-upload. Default 3; higher can be faster but less stable on weak networks.",
      },
      webdav_endpoint: "Full access URL for the WebDAV service",
      tls_insecure_skip_verify: "Skip TLS certificate verification (insecure, for testing only)",
      root_path: "Root directory path for local file storage, must be an absolute path",
      readonly: "Enable read-only mode, disabling write and delete operations",
      local: {
        enable_disk_usage:
          "When enabled, fetch host disk total/used/available for admin dashboard quota analysis and upload limit validation.",
      },

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
        enable_disk_usage: "When enabled, fetch OneDrive storage quota information for admin dashboard quota analysis and upload limit validation.",
      },

      webdav: {
        enable_disk_usage:
          "When enabled, try to read WebDAV quota via quota properties for admin dashboard quota analysis and upload limit validation (not supported by all WebDAV servers).",
      },

      // Google Drive descriptions
      googledrive: {
        use_online_api: "When enabled, use the Online API endpoint to obtain access tokens, suitable for centralized token services.",
        endpoint_url: "Online API refresh address, call to obtain access_token and refresh_token.",
        client_id: "Client ID used in standard OAuth mode, created in GCP console.",
        client_secret: "Client secret used together with refresh_token to refresh access_token in standard OAuth mode.",
        refresh_token: "Supports two forms: 1) standard OAuth refresh_token; 2) remote Service Account JSON URL.",
        root_id: "Google Drive root folder ID, defaults to root; set to driveId when mounting a Shared Drive.",
        enable_disk_usage: "When enabled, fetch storage quota information for admin dashboard quota analysis and upload limit validation.",
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
        endpoint_url: "Optional: custom API(for GitHub Enterprise). Default is https://api.github.com.",
        gh_proxy: "Optional: accelerate raw direct links by replacing https://raw.githubusercontent.com with this value (direct-link output only).",
        committer_name: "Optional: commit committer.name (must be paired with committer_email).",
        committer_email: "Optional: commit committer.email (must be paired with committer_name).",
        author_name: "Optional: commit author.name (must be paired with author_email).",
        author_email: "Optional: commit author.email (must be paired with author_name).",
        token: "Required: GitHub access token for higher rate limits and write operations (create commits / update refs).",
      },

      telegram: {
        bot_token: "Used for calling Telegram Bot API to upload/download files",
        target_chat_id: "Files will be sent to this channel/group (need to add the bot and grant message sending permission)",
        endpoint_url: "Default official address; if you later build your own Bot API server, you can switch to your own address",
        bot_api_mode:
          "Unchecked self-built: According to official Bot API rules, the maximum single upload size is ≤20MB; Checked self-built: You provide your own Bot API Server, these restrictions can be relaxed",
        part_size_mb:
          "Chunk size for resumable upload on the mount page; default is 15MB. It is recommended to be ≤20MB when self-built is unchecked; can be unlimited when self-built is checked",
        upload_concurrency: "Limit the number of simultaneous requests to Telegram for the same storage configuration to avoid rate limiting due to high concurrency",
        verify_after_upload:
          "When enabled, each chunk will be re-verified for size after successful upload, slightly slower but more stable (default is fine unless there are special circumstances)",
      },

      discord: {
        bot_token: "Used to call the Discord Bot API",
        channel_id: "Files will be uploaded to this channel (the bot must be in this channel/server and have permissions to view/send messages/upload attachments)",
        endpoint_url: "Optional: custom Discord API base (default https://discord.com/api/v10). Only change when using a proxy/reverse-proxy/gateway; please set it to the /api/v10 level.",
        part_size_mb: "Chunk size for resumable uploads; recommended 8~10MB (Discord's single upload limit is max 10MB, 25MB for Nitro users)",
        upload_concurrency: "Limit the number of concurrent requests sent to Discord under the same storage configuration to avoid 429 rate limits due to high concurrency",
      },

      huggingface_datasets: {
        repo: "HuggingFace dataset repository ID (format: owner/name). This refers to a HuggingFace Datasets 'repository', not a local path.",
        revision: "Branch/version: Recommended to specify a branch name (e.g., main). If a tag or commit SHA is provided, read-only access is enforced.",
        endpoint_url: "Hub site address. Default: https://huggingface.co; modify only if using a self-hosted mirror/proxy.",
        hf_token: "Optional: Required for accessing private/gated repositories or increasing rate limits.",
        hf_use_paths_info:
          "When enabled, directory listings include additional details (e.g., 'modification time + Xet/LFS flags'). More comprehensive but increases response size and may trigger rate limits more easily.",
        hf_tree_limit:
          "Number of items per page for the tree API (HF's 'limit' parameter). Used with the 'Show more info' toggle—max 100 when enabled, 1000 when disabled. Default is sufficient.",
        hf_multipart_concurrency: "How many parts to upload in parallel. Higher is faster but consumes more network and is more likely to fail (default 3; suggested 3–8).",
        hf_use_xet:
          "When enabled, write operations attempt to use Xet (new backend). However, some environments (e.g., Cloudflare Workers) may block runtime WebAssembly compilation, causing write failures. Disabled by default for stability.",
        hf_delete_lfs_on_remove:
          "When enabled: deleting a file in CloudPaste will also call HuggingFace to permanently delete the matching LFS object (so it disappears from HuggingFace “List LFS files”).\nWhen disabled: CloudPaste only deletes the repo file entry (a pointer), and the LFS blob may remain on HuggingFace—so uploading the exact same content again can become “instant upload/skip”.\nNote: If two files have completely identical content (same SHA), cleaning LFS may affect another file or the download of an older version.",
      },

      mirror: {
        preset: "Automatically fetches mirror site directory page links according to the corresponding template rules.",
        endpoint_url:
          "Root address of the mirror directory (must start with http(s)://). It will be auto-filled after selecting a template, or you can manually change it to another mirror site address.",
        max_entries: "Maximum number of entries returned per directory listing. Lower it for very large directories to avoid slowdowns/timeouts.",
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
