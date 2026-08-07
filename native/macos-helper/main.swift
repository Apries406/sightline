import AppKit
import CoreGraphics
import Foundation

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

struct PermissionResult: Encodable {
    let screenRecordingLikelyGranted: Bool
    let accessibilityTrusted: Bool
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
case "permissions":
    permissionStatus()
default:
    fail("unknown command: \(command)")
}
