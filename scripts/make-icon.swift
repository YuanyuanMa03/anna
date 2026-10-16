import AppKit

let output = CommandLine.arguments[1]
try FileManager.default.createDirectory(atPath: output, withIntermediateDirectories: true)
for size in [16, 32, 128, 256, 512] {
    for multiplier in [1, 2] {
        let pixels = size * multiplier
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: pixels * 4, bitsPerPixel: 32)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        let p = CGFloat(pixels)
        let background = NSBezierPath(roundedRect: NSRect(x: p * 0.08, y: p * 0.08, width: p * 0.84, height: p * 0.84), xRadius: p * 0.19, yRadius: p * 0.19)
        NSColor(calibratedRed: 0.95, green: 0.91, blue: 0.98, alpha: 1).setFill()
        background.fill()
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont(name: "Georgia-Italic", size: p * 0.76)!,
            .foregroundColor: NSColor(calibratedRed: 0.48, green: 0.36, blue: 0.60, alpha: 1)
        ]
        let text = "a" as NSString
        let bounds = text.size(withAttributes: attributes)
        text.draw(at: NSPoint(x: (p - bounds.width) / 2 - p * 0.025, y: (p - bounds.height) / 2 + p * 0.045), withAttributes: attributes)
        NSGraphicsContext.restoreGraphicsState()
        let suffix = multiplier == 2 ? "@2x" : ""
        let path = "\(output)/icon_\(size)x\(size)\(suffix).png"
        try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
    }
}
