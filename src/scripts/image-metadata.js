export async function readImageMetadata(file) {
  // Reading the original bytes avoids FileReader/realm-specific File handling
  // and preserves metadata that would be lost by re-encoding the preview.
  const bytes = await file.arrayBuffer();
  let module;
  try {
    module = await import("exifreader");
  } catch (cause) {
    const error = new Error("The metadata reader could not load. Refresh this page, then choose your image again.", { cause });
    error.name = "MetadataReaderLoadError";
    throw error;
  }
  const reader = module.default ?? module;
  try {
    return await reader.load(bytes, { expanded: true, async: true });
  } catch (error) {
    if (error.name === "MetadataMissingError") return {};
    throw error;
  }
}
