// foliate-js 的 PDF 支持在其 pdf.js 里使用了 Vite 不兼容的 glob（以及 top-level await）。
// 让我们能正常使用 foliate-js 的 EPUB 渲染能力。

export const makePDF = async () => {
  throw new Error("foliate-js PDF preview is disabled in CloudPaste (use built-in PDF preview instead).");
};

