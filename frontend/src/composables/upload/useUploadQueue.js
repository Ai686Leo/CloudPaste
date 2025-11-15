import { ref } from "vue";

const FILE_STATUS = {
  PENDING: "pending",
  UPLOADING: "uploading",
  SUCCESS: "success",
  ERROR: "error",
};

const generateItemId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createFileItem = (file) => ({
  id: generateItemId(),
  file,
  progress: 0,
  status: FILE_STATUS.PENDING,
  message: "",
  fileId: null,
  xhr: null,
});

export function useUploadQueue(options = {}) {
  const fileInput = ref(null);
  const selectedFiles = ref([]);
  const fileItems = ref([]);
  const isDragging = ref(false);

  const dedupeKey = (file) => `${file.name}-${file.size}-${file.lastModified}`;

  const appendFiles = (fileList) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const existing = new Set(selectedFiles.value.map(dedupeKey));

    files.forEach((file) => {
      const key = dedupeKey(file);
      if (existing.has(key)) return;
      existing.add(key);
      selectedFiles.value.push(file);
      fileItems.value.push(createFileItem(file));
    });
  };

  const removeFileAt = (index) => {
    if (index < 0 || index >= selectedFiles.value.length) return;
    selectedFiles.value.splice(index, 1);
    fileItems.value.splice(index, 1);
  };

  const clearAllFiles = () => {
    selectedFiles.value = [];
    fileItems.value = [];
  };

  const triggerFileInput = () => {
    fileInput.value?.click();
  };

  const onFileSelected = (event) => {
    const files = event?.target?.files;
    appendFiles(files);
    if (event?.target) {
      event.target.value = "";
    }
  };

  const onDragOver = (event) => {
    event?.preventDefault?.();
    isDragging.value = true;
  };

  const onDragLeave = (event) => {
    event?.preventDefault?.();
    isDragging.value = false;
  };

  const onDrop = (event) => {
    if (!event?.dataTransfer) return;
    event.preventDefault();
    isDragging.value = false;
    appendFiles(event.dataTransfer.files);
  };

  const onPasteFiles = (files) => {
    appendFiles(files);
  };

  const updateFileItem = (index, patch) => {
    const item = fileItems.value[index];
    if (!item) return;
    fileItems.value[index] = { ...item, ...patch };
  };

  return {
    fileInput,
    selectedFiles,
    fileItems,
    isDragging,
    appendFiles,
    removeFileAt,
    clearAllFiles,
    triggerFileInput,
    onFileSelected,
    onDragOver,
    onDragLeave,
    onDrop,
    onPasteFiles,
    updateFileItem,
    FILE_STATUS,
  };
}

