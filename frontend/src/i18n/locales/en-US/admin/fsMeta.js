export default {
  fsMeta: {
    // Header & toolbar
    title: "Metadata Management",
    toolbar: {
      create: "Create Metadata",
      createShort: "New",
      refresh: "Refresh",
      refreshing: "Refreshing...",
      refreshShort: "Ref",
    },

    // Search & statistics
    search: {
      placeholder: "Search path...",
      hint: "Client-side search, supports fuzzy path matching",
    },
    stats: {
      total: "Total {count} records",
      searchResultTag: "(Search results)",
    },
    lastRefresh: "Last refreshed",

    // Common texts
    common: {
      notSet: "Not set",
      set: "Set",
      inherited: "Inherited",
      inheritedSuffix: " (inherited)",
      loading: "Loading...",
      noDataCell: "No data",
    },

    // Table
    table: {
      path: "Path",
      headerMarkdown: "Header Notes",
      footerMarkdown: "Footer Notes",
      hidePatterns: "Hide Rules",
      password: "Password",
      createdAt: "Created At",
      actions: "Actions",
      noData: "No metadata records",
    },

    // Form
    form: {
      titleCreate: "Create Metadata",
      titleEdit: "Edit Metadata",
      tabs: {
        basic: "Basic Information",
        path: "Path Selection",
      },
      path: {
        label: "Path",
        required: "Path is required",
        placeholder: "/claw",
        helper: "File system path, must start with /, you can use the button on the right to select",
        selectButton: "Select Path",
      },
      headerMarkdown: {
        label: "Header Notes (Markdown)",
        placeholder: "Header notes in Markdown...",
        inheritLabel: "Apply to subdirectories",
      },
      footerMarkdown: {
        label: "Footer Notes (Markdown)",
        placeholder: "Footer notes in Markdown...",
        inheritLabel: "Apply to subdirectories",
      },
      hidePatterns: {
        label: "Hide Rules (RegExp)",
        placeholder:
          "One regex per line, for example:\n^\\\\..*\n.*\\\\.tmp$\nnode_modules",
        inheritLabel: "Apply hide rules to subdirectories",
        helper: "Matched files will be hidden in the UI (one regex per line)",
      },
      password: {
        label: "Access Password",
        placeholderKeep: "Leave empty to keep unchanged",
        placeholderSetOptional: "Set directory password (optional)",
        inheritLabel: "Apply password protection to subdirectories",
        helper: "When set, accessing this path requires password verification",
      },
      pathSelector: {
        currentSelection: "Current Selection",
        selectDirectory: "Select Directory",
        rootLabel: "/",
        loading: "Loading...",
      },
      actions: {
        cancel: "Cancel",
        create: "Create",
        creating: "Creating...",
        update: "Update",
        updating: "Updating...",
      },
      errors: {
        submitFailed: "Submit failed",
      },
    },

    // Password status
    passwordStatus: {
      inherited: "Inherited protection",
      protected: "Protected",
    },

    // Hide patterns display
    hidePatternsStatus: {
      count: "{count} rules",
    },

    // Delete confirm
    confirmDelete: {
      title: "Confirm Delete",
      message: 'Are you sure you want to delete metadata for path "{path}"?',
      confirm: "Delete",
      cancel: "Cancel",
    },

    // Empty & error
    empty: {
      noData: "No metadata records",
      noSearchResults: "No matching metadata records found",
      createFirst: "Create the first record",
    },
    error: {
      loadFailed: "Failed to load metadata list",
      createFailed: "Failed to create metadata",
      updateFailed: "Failed to update metadata",
      deleteFailed: "Failed to delete metadata",
    },
    actions: {
      edit: "Edit",
      delete: "Delete",
    },
  },
};

