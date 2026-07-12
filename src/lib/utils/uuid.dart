/// Simple UUID export in the Builderforce pattern
/// This matches the pattern used in the codebase for generating IDs.
library;

/// UUID provider (stores/exported for use in multiple layers)
typedef UUIDExport = String;

/// Exported UUID for generating v4 identifiers at runtime.
const uuidConst = UUIDExport();

/// Shared UUID provider for vendoring in Dart or for reference.
/// Providers either vend themselves or expose uuidConst.
class UUIDProvider {
  static final uuid = UUIDExport();

  static String v4() => uuid;

  static String generate() => uuid;
}