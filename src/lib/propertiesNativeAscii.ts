/** Java properties \\uXXXX ↔ native 문자 변환 (native2ascii / unescape) */

export function isPropertiesFile(path: string): boolean {
  return /\.properties$/i.test(path);
}

/** \\uXXXX 및 \\n \\t 등을 실제 문자로 변환 */
export function asciiToNative(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i++;
    if (i >= input.length) {
      out += "\\";
      break;
    }
    const esc = input[i];
    if (esc === "u") {
      const hex = input.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        continue;
      }
      out += "\\u";
      continue;
    }
    switch (esc) {
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "f":
        out += "\f";
        break;
      case "\\":
        out += "\\";
        break;
      default:
        out += esc;
        break;
    }
  }
  return out;
}

/** 127 초과 문자를 \\uXXXX 로 변환 (JDK native2ascii 호환) */
export function nativeToAscii(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const code = ch.charCodeAt(0);
    if (ch === "\\") {
      out += "\\\\";
    } else if (code > 127) {
      out += "\\u" + code.toString(16).toUpperCase().padStart(4, "0");
    } else {
      out += ch;
    }
  }
  return out;
}

export function draftToRaw(draft: string, nativeDisplay: boolean, path: string): string {
  if (nativeDisplay && isPropertiesFile(path)) return nativeToAscii(draft);
  return draft;
}

export function rawToDraft(raw: string, nativeDisplay: boolean, path: string): string {
  if (nativeDisplay && isPropertiesFile(path)) return asciiToNative(raw);
  return raw;
}
