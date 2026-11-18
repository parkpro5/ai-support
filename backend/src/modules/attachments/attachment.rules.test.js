// vitest 는 ESM 전용이라 테스트 파일만 import 문법을 쓴다. 소스(CommonJS)는 기본 import 후 구조 분해한다.
import { describe, it, expect } from 'vitest';
import rules from './attachment.rules.js';

const {
  ALLOWED_TYPES,
  MAX_FILE_BYTES,
  MAX_FILE_NAME_LENGTH,
  sanitizeFileName,
  extensionOf,
  validateFile,
  buildStoragePath,
  isStoragePathForRequest,
} = rules;

const REQUEST_ID = '3f2b8a52-6f5c-4a43-9a6e-1d2f6b8f0a11';
const UUID = '0b8e3f10-9a3c-4c52-8d41-2f7f3b6a9e11';

describe('허용 형식과 크기 상수', () => {
  it('허용 확장자는 지침서의 8가지(jpg는 jpeg도 함께)이다', () => {
    expect(Object.keys(ALLOWED_TYPES).sort()).toEqual(['docx', 'hwp', 'hwpx', 'jpeg', 'jpg', 'pdf', 'png', 'pptx', 'xlsx']);
  });

  it('최대 크기는 10MB이다', () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('실행 파일·웹 문서·스크립트·SVG는 허용하지 않는다(내려받는 사람의 브라우저에서 실행될 수 있다)', () => {
    for (const ext of ['exe', 'bat', 'js', 'html', 'htm', 'svg', 'php', 'sh', 'zip', 'dll']) {
      expect(Object.hasOwn(ALLOWED_TYPES, ext), ext).toBe(false);
    }
  });
});

describe('sanitizeFileName', () => {
  it('경로 구분자 앞부분을 버리고 이름만 남긴다(경로 조작 방지)', () => {
    expect(sanitizeFileName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeFileName('C:\\Users\\kim\\보고서.pdf')).toBe('보고서.pdf');
    expect(sanitizeFileName('folder/sub/file.png')).toBe('file.png');
  });

  it('제어문자를 없애고 앞뒤 공백을 제거한다', () => {
    expect(sanitizeFileName('  a\u0000b\nc\u007f.pdf \t')).toBe('abc.pdf');
  });

  it('한글·공백이 든 이름은 그대로 둔다', () => {
    expect(sanitizeFileName('2026 월간 보고서 (최종).hwpx')).toBe('2026 월간 보고서 (최종).hwpx');
  });

  it('이름이 없거나 경로만 있으면 빈 문자열', () => {
    expect(sanitizeFileName('')).toBe('');
    expect(sanitizeFileName('   ')).toBe('');
    expect(sanitizeFileName('folder/')).toBe('');
    expect(sanitizeFileName(null)).toBe('');
    expect(sanitizeFileName(undefined)).toBe('');
  });

  it('긴 이름은 확장자를 살리고 앞부분을 줄여 상한에 맞춘다', () => {
    const result = sanitizeFileName(`${'가'.repeat(400)}.pdf`);
    expect(result.length).toBe(MAX_FILE_NAME_LENGTH);
    expect(result.endsWith('.pdf')).toBe(true);
  });
});

describe('extensionOf', () => {
  it('소문자 확장자를 점 없이 돌려준다', () => {
    expect(extensionOf('a.PDF')).toBe('pdf');
    expect(extensionOf('보고서.최종.HWPX')).toBe('hwpx');
  });

  it('확장자가 없거나 점으로 끝나거나 점으로 시작하면 빈 문자열', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('file.')).toBe('');
    expect(extensionOf('.pdf')).toBe('');
  });
});

describe('validateFile', () => {
  it.each(Object.keys(ALLOWED_TYPES))('.%s 파일은 통과하고 표준 content-type을 정해 준다', (ext) => {
    const result = validateFile({ fileName: `파일.${ext}`, size: 1000 });
    expect(result).toEqual({ ok: true, fileName: `파일.${ext}`, ext, contentType: ALLOWED_TYPES[ext] });
  });

  it('확장자 대소문자는 구분하지 않는다', () => {
    expect(validateFile({ fileName: 'SCAN.PDF', size: 10 })).toMatchObject({ ok: true, ext: 'pdf' });
    expect(validateFile({ fileName: 'Photo.JpG', size: 10 })).toMatchObject({ ok: true, contentType: 'image/jpeg' });
  });

  it.each(['run.exe', 'page.html', 'icon.svg', 'script.js', 'archive.zip', 'noext', 'trailing.', '.pdf'])(
    '허용되지 않는 형식(%s)은 fileName 오류',
    (fileName) => {
      const result = validateFile({ fileName, size: 10 });
      expect(result).toMatchObject({ ok: false, field: 'fileName' });
      expect(result.message).toBeTruthy();
    }
  );

  it('마지막 확장자만 본다: 이중 확장자로 위장한 실행 파일은 거부', () => {
    expect(validateFile({ fileName: 'invoice.pdf.exe', size: 10 })).toMatchObject({ ok: false, field: 'fileName' });
    expect(validateFile({ fileName: 'a.exe.pdf', size: 10 })).toMatchObject({ ok: true });
  });

  it('이름이 비면 fileName 오류', () => {
    expect(validateFile({ fileName: '  ', size: 10 })).toMatchObject({ ok: false, field: 'fileName' });
    expect(validateFile({ fileName: undefined, size: 10 })).toMatchObject({ ok: false, field: 'fileName' });
  });

  it('크기 경계: 1바이트와 정확히 10MB는 통과, 0·음수·10MB+1은 size 오류', () => {
    expect(validateFile({ fileName: 'a.pdf', size: 1 }).ok).toBe(true);
    expect(validateFile({ fileName: 'a.pdf', size: MAX_FILE_BYTES }).ok).toBe(true);
    for (const size of [0, -1, MAX_FILE_BYTES + 1]) {
      expect(validateFile({ fileName: 'a.pdf', size }), String(size)).toMatchObject({ ok: false, field: 'size' });
    }
  });

  it('크기가 정수가 아니면 size 오류', () => {
    for (const size of [1.5, Number.NaN, Number.POSITIVE_INFINITY, '100', null, undefined]) {
      expect(validateFile({ fileName: 'a.pdf', size }), String(size)).toMatchObject({ ok: false, field: 'size' });
    }
  });

  it('돌려주는 파일 이름은 다듬어진 값이다', () => {
    expect(validateFile({ fileName: '../x/y/보고서.pdf', size: 10 }).fileName).toBe('보고서.pdf');
  });
});

describe('저장소 경로', () => {
  it('사용자가 보낸 이름 없이 요청서 id, uuid, 확장자로만 만든다', () => {
    expect(buildStoragePath(REQUEST_ID, 'pdf', UUID)).toBe(`${REQUEST_ID}/${UUID}.pdf`);
  });

  it('만든 경로는 같은 요청서용으로 인정된다', () => {
    for (const ext of Object.keys(ALLOWED_TYPES)) {
      expect(isStoragePathForRequest(buildStoragePath(REQUEST_ID, ext, UUID), REQUEST_ID), ext).toBe(true);
    }
  });

  it('다른 요청서의 경로는 거부한다', () => {
    const other = '11111111-2222-4333-8444-555555555555';
    expect(isStoragePathForRequest(`${other}/${UUID}.pdf`, REQUEST_ID)).toBe(false);
  });

  it.each([
    ['상위 폴더 이동', `${REQUEST_ID}/../${UUID}.pdf`],
    ['하위 폴더', `${REQUEST_ID}/sub/${UUID}.pdf`],
    ['uuid가 아닌 이름', `${REQUEST_ID}/report.pdf`],
    ['허용되지 않는 확장자', `${REQUEST_ID}/${UUID}.exe`],
    ['확장자 없음', `${REQUEST_ID}/${UUID}`],
    ['대문자 확장자', `${REQUEST_ID}/${UUID}.PDF`],
    ['앞뒤에 붙은 문자', `x${REQUEST_ID}/${UUID}.pdf`],
    ['뒤에 붙은 문자', `${REQUEST_ID}/${UUID}.pdf/`],
    ['빈 값', ''],
  ])('형식이 다르면 거부: %s', (_name, path) => {
    expect(isStoragePathForRequest(path, REQUEST_ID)).toBe(false);
  });

  it('문자열이 아니면 거부', () => {
    for (const value of [null, undefined, 123, {}, []]) {
      expect(isStoragePathForRequest(value, REQUEST_ID)).toBe(false);
    }
  });

  it('요청서 id에 정규식 특수문자가 있어도 안전하게 비교한다', () => {
    expect(isStoragePathForRequest(`a.b/${UUID}.pdf`, 'a.b')).toBe(true);
    expect(isStoragePathForRequest(`axb/${UUID}.pdf`, 'a.b')).toBe(false);
  });
});
