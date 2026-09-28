# Preserve original images alongside viewing derivatives

Keep uploaded original photographs and create separate smaller derivatives for the journal feed. This preserves the family image independently of interface optimizations, at the cost of storing both originals and derived files. Changing preview sizes or formats must not replace or degrade the retained original.

The original is stored byte-for-byte, including its EXIF metadata and any GPS location; derivatives are generated without metadata, so the feed and offline caches never carry location data. Stripping location from originals at upload was rejected because it alters the family archive. Uploads accept HEIC from iPhones; derivatives are produced in web formats. HEIC decoding is not included in sharp's prebuilt binaries, so the worker image must provide it on both amd64 and arm64, verified during foundation implementation.
