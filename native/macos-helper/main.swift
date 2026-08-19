import AppKit
import AVFoundation
import CoreMedia
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

struct Bounds: Encodable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

struct DisplayInfo: Encodable {
    let id: UInt32
    let main: Bool
    let bounds: Bounds
    let scale: Double
}

struct WindowInfo: Encodable {
    let id: UInt32
    let ownerName: String
    let bundleId: String?
    let pid: Int32
    let title: String
    let layer: Int
    let bounds: Bounds
    let onScreen: Bool
    let alpha: Double
}

struct CaptureResult: Encodable {
    let ok: Bool
    let path: String
    let width: Int
    let height: Int
}

struct RecordResult: Encodable {
    let ok: Bool
    let path: String
    let width: Int
    let height: Int
    let duration: Double
}

struct PermissionResult: Encodable {
    let screenRecordingLikelyGranted: Bool
    let accessibilityTrusted: Bool
}

final class WindowRecorder: NSObject, SCStreamOutput {
    let outputURL: URL
    let duration: Double
    let width: Int
    let height: Int
    var writer: AVAssetWriter?
    var input: AVAssetWriterInput?
    var stream: SCStream?
    var error: Error?
    var didStartWriting = false
    var lastPTS: CMTime?

    init(outputURL: URL, duration: Double, width: Int, height: Int) {
        self.outputURL = outputURL
        self.duration = duration
        self.width = width
        self.height = height
    }

    func start(filter: SCContentFilter, config: SCStreamConfiguration) async throws {
        try? FileManager.default.removeItem(at: outputURL)
        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: max(1_000_000, width * height * 4),
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw NSError(domain: "Sightline", code: 1, userInfo: [NSLocalizedDescriptionKey: "cannot add video input"])
        }
        writer.add(input)
        self.writer = writer
        self.input = input

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "sightline.record.screen"))
        self.stream = stream
        try await stream.startCapture()
        try await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
        await stop()
    }

    func stop() async {
        do {
            try await stream?.stopCapture()
        } catch {
            self.error = error
        }
        guard let writer, let input, didStartWriting else {
            self.error = NSError(domain: "Sightline", code: 2, userInfo: [NSLocalizedDescriptionKey: "native recorder did not receive any complete frames"])
            return
        }
        if let lastPTS {
            writer.endSession(atSourceTime: lastPTS)
        }
        input.markAsFinished()
        await withCheckedContinuation { continuation in
            writer.finishWriting {
                continuation.resume()
            }
        }
    }

    nonisolated func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen else { return }
        guard CMSampleBufferIsValid(sampleBuffer) else { return }
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int,
              status == SCFrameStatus.complete.rawValue else {
            return
        }
        guard let writer = self.writer, let input = self.input else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        lastPTS = pts
        if writer.status == .unknown {
            writer.startWriting()
            writer.startSession(atSourceTime: pts)
            didStartWriting = true
        }
        if input.isReadyForMoreMediaData {
            _ = input.append(sampleBuffer)
        }
    }
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    let payload = ["ok": false, "error": message] as [String: Any]
    if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
       let text = String(data: data, encoding: .utf8) {
        fputs(text + "\n", stderr)
    } else {
        fputs("error: \(message)\n", stderr)
    }
    exit(code)
}

func printJSON<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    do {
        let data = try encoder.encode(value)
        print(String(data: data, encoding: .utf8)!)
    } catch {
        fail("failed to encode JSON: \(error)")
    }
}

func parseArgs() -> (String, [String: String], [String]) {
    let raw = Array(CommandLine.arguments.dropFirst())
    guard let command = raw.first else {
        fail("missing command")
    }
    var options: [String: String] = [:]
    var positional: [String] = []
    var index = 1
    while index < raw.count {
        let arg = raw[index]
        if arg.hasPrefix("--") {
            let key = String(arg.dropFirst(2))
            if index + 1 >= raw.count || raw[index + 1].hasPrefix("--") {
                options[key] = "true"
                index += 1
            } else {
                options[key] = raw[index + 1]
                index += 2
            }
        } else {
            positional.append(arg)
            index += 1
        }
    }
    return (command, options, positional)
}

func boundsFromDict(_ dict: CFDictionary) -> Bounds? {
    var rect = CGRect.zero
    guard CGRectMakeWithDictionaryRepresentation(dict, &rect) else {
        return nil
    }
    return Bounds(
        x: Int(rect.origin.x.rounded()),
        y: Int(rect.origin.y.rounded()),
        width: Int(rect.size.width.rounded()),
        height: Int(rect.size.height.rounded())
    )
}

func listDisplays() {
    var count: UInt32 = 0
    let err = CGGetActiveDisplayList(0, nil, &count)
    guard err == .success else {
        fail("CGGetActiveDisplayList count failed: \(err.rawValue)")
    }
    var ids = Array<CGDirectDisplayID>(repeating: 0, count: Int(count))
    let err2 = CGGetActiveDisplayList(count, &ids, &count)
    guard err2 == .success else {
        fail("CGGetActiveDisplayList failed: \(err2.rawValue)")
    }
    let mainId = CGMainDisplayID()
    let displays = ids.map { id in
        let rect = CGDisplayBounds(id)
        let scale = NSScreen.screens.first { screen in
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
                return false
            }
            return number.uint32Value == id
        }?.backingScaleFactor ?? 1.0
        return DisplayInfo(
            id: id,
            main: id == mainId,
            bounds: Bounds(
                x: Int(rect.origin.x.rounded()),
                y: Int(rect.origin.y.rounded()),
                width: Int(rect.size.width.rounded()),
                height: Int(rect.size.height.rounded())
            ),
            scale: scale
        )
    }
    printJSON(displays)
}

func bundleIdForPID(_ pid: pid_t) -> String? {
    return NSRunningApplication(processIdentifier: pid)?.bundleIdentifier
}

func listWindows() {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        fail("failed to list windows")
    }
    let windows: [WindowInfo] = list.compactMap { item in
        guard let id = item[kCGWindowNumber as String] as? UInt32,
              let owner = item[kCGWindowOwnerName as String] as? String,
              let pid = item[kCGWindowOwnerPID as String] as? Int32,
              let boundsDict = item[kCGWindowBounds as String] as? NSDictionary,
              let bounds = boundsFromDict(boundsDict as CFDictionary) else {
            return nil
        }
        let title = item[kCGWindowName as String] as? String ?? ""
        let layer = item[kCGWindowLayer as String] as? Int ?? 0
        let onScreen = item[kCGWindowIsOnscreen as String] as? Bool ?? true
        let alpha = item[kCGWindowAlpha as String] as? Double ?? 1.0
        guard bounds.width > 0 && bounds.height > 0 else {
            return nil
        }
        return WindowInfo(
            id: id,
            ownerName: owner,
            bundleId: bundleIdForPID(pid),
            pid: pid,
            title: title,
            layer: layer,
            bounds: bounds,
            onScreen: onScreen,
            alpha: alpha
        )
    }
    printJSON(windows)
}

func parseRect(_ value: String) -> CGRect {
    let parts = value.split(separator: ",").map(String.init)
    guard parts.count == 4,
          let x = Double(parts[0]),
          let y = Double(parts[1]),
          let w = Double(parts[2]),
          let h = Double(parts[3]) else {
        fail("rect must be x,y,w,h")
    }
    return CGRect(x: x, y: y, width: w, height: h)
}

func writePNG(_ image: CGImage, to path: String) {
    let url = URL(fileURLWithPath: path)
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fail("failed to create image destination: \(path)")
    }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else {
        fail("failed to write image: \(path)")
    }
}

func defaultScreenScale() -> Double {
    Double(NSScreen.main?.backingScaleFactor ?? 1.0)
}

func captureWindowNative(_ options: [String: String]) {
    guard let idText = options["id"], let id = UInt32(idText) else {
        fail("capture-window-native requires --id")
    }
    guard let path = options["output"] else {
        fail("capture-window-native requires --output")
    }

    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)

    if #available(macOS 14.0, *) {
        let sem = DispatchSemaphore(value: 0)
        var captureError: Error?
        Task { @MainActor in
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                guard let window = content.windows.first(where: { $0.windowID == id }) else {
                    fail("window not found in ScreenCaptureKit content: \(id)")
                }
                let scale = defaultScreenScale()
                let filter = SCContentFilter(desktopIndependentWindow: window)
                let config = SCStreamConfiguration()
                config.width = max(1, Int((window.frame.width * scale).rounded()))
                config.height = max(1, Int((window.frame.height * scale).rounded()))
                config.showsCursor = false
                config.capturesAudio = false
                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
                writePNG(image, to: path)
                printJSON(CaptureResult(ok: true, path: path, width: image.width, height: image.height))
            } catch {
                captureError = error
            }
            sem.signal()
        }
        while sem.wait(timeout: .now()) != .success {
            RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
        }
        if let captureError {
            fail("native window capture failed: \(captureError)")
        }
    } else {
        fail("native window capture requires macOS 14+")
    }
}

func recordWindowNative(_ options: [String: String]) {
    guard let idText = options["id"], let id = UInt32(idText) else {
        fail("record-window-native requires --id")
    }
    guard let durationText = options["duration"], let duration = Double(durationText), duration > 0 else {
        fail("record-window-native requires --duration")
    }
    guard let path = options["output"] else {
        fail("record-window-native requires --output")
    }

    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)

    if #available(macOS 14.0, *) {
        let sem = DispatchSemaphore(value: 0)
        var recordError: Error?
        Task { @MainActor in
            do {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                guard let window = content.windows.first(where: { $0.windowID == id }) else {
                    fail("window not found in ScreenCaptureKit content: \(id)")
                }
                let scale = defaultScreenScale()
                let width = max(2, Int((window.frame.width * scale).rounded()))
                let height = max(2, Int((window.frame.height * scale).rounded()))
                let filter = SCContentFilter(desktopIndependentWindow: window)
                let config = SCStreamConfiguration()
                config.width = width
                config.height = height
                config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
                config.queueDepth = 8
                config.showsCursor = false
                config.capturesAudio = false
                let recorder = WindowRecorder(outputURL: URL(fileURLWithPath: path), duration: duration, width: width, height: height)
                try await recorder.start(filter: filter, config: config)
                if let error = recorder.error {
                    throw error
                }
                printJSON(RecordResult(ok: true, path: path, width: width, height: height, duration: duration))
            } catch {
                recordError = error
            }
            sem.signal()
        }
        while sem.wait(timeout: .now()) != .success {
            RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
        }
        if let recordError {
            fail("native window record failed: \(recordError)")
        }
    } else {
        fail("native window record requires macOS 14+")
    }
}

func permissionStatus() {
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    let hasNamedForeignWindow = windows.contains { item in
        let pid = item[kCGWindowOwnerPID as String] as? Int32 ?? 0
        let title = item[kCGWindowName as String] as? String ?? ""
        return pid != getpid() && !title.isEmpty
    }
    let accessibility = AXIsProcessTrusted()
    printJSON(PermissionResult(screenRecordingLikelyGranted: hasNamedForeignWindow, accessibilityTrusted: accessibility))
}

let (command, options, _) = parseArgs()
switch command {
case "list-displays":
    listDisplays()
case "list-windows":
    listWindows()
case "capture-window-native":
    captureWindowNative(options)
case "record-window-native":
    recordWindowNative(options)
case "permissions":
    permissionStatus()
default:
    fail("unknown command: \(command)")
}
