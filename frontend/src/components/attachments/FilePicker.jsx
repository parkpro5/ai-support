import { useId, useRef, useState } from 'react';
import { ACCEPT_ATTRIBUTE, ALLOWED_EXTENSIONS, MAX_FILES, formatFileSize, validateClientFile } from '../../utils/attachmentRules';
import Button from '../common/Button';

/**
 * 올릴 파일을 고르는 입력. 고른 파일은 부모가 가진 목록(files)에 쌓이고, 실제 업로드는 부모가 저장할 때 한다.
 * @param {{ files: File[], onChange: (files: File[]) => void, existingCount?: number, disabled?: boolean }} props
 *   existingCount: 이미 올려 둔 파일 수(전체 개수 상한 계산에 쓴다)
 */
export default function FilePicker({ files, onChange, existingCount = 0, disabled = false }) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [error, setError] = useState(null);

  const room = MAX_FILES - existingCount - files.length;

  function handleSelect(e) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ''; // 같은 파일을 다시 고를 수 있게 비운다
    if (picked.length === 0) return;

    const accepted = [];
    const problems = [];
    for (const file of picked) {
      const problem = validateClientFile(file);
      if (problem) problems.push(`${file.name}: ${problem}`);
      else if (files.some((f) => f.name === file.name && f.size === file.size) || accepted.some((f) => f.name === file.name && f.size === file.size)) {
        problems.push(`${file.name}: 이미 선택한 파일입니다`);
      } else accepted.push(file);
    }

    const fits = accepted.slice(0, Math.max(room, 0));
    if (fits.length < accepted.length) problems.push(`파일은 최대 ${MAX_FILES}개까지 올릴 수 있습니다`);

    setError(problems.length > 0 ? problems : null);
    if (fits.length > 0) onChange([...files, ...fits]);
  }

  return (
    <div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        onChange={handleSelect}
        disabled={disabled || room <= 0}
        aria-label="첨부할 파일 선택"
        aria-describedby={`${inputId}-hint`}
        style={{ display: 'block', maxWidth: '100%' }}
      />
      <p id={`${inputId}-hint`} style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
        {ALLOWED_EXTENSIONS.join(', ')} 파일, 파일당 10MB 이하, 최대 {MAX_FILES}개
      </p>

      {error && (
        <ul role="alert" style={{ margin: 'var(--spacing-2) 0 0', paddingLeft: '1.2em', color: 'var(--color-danger)', fontSize: '0.9rem' }}>
          {error.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul style={{ margin: 'var(--spacing-2) 0 0', padding: 0 }} aria-label="올릴 파일">
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}`}
              style={{ listStyle: 'none', display: 'flex', justifyContent: 'space-between', gap: 'var(--spacing-2)', alignItems: 'center', padding: '4px 0' }}
            >
              <span style={{ wordBreak: 'break-all' }}>
                {file.name} <span style={{ color: 'var(--color-text-muted)' }}>({formatFileSize(file.size)})</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                aria-label={`${file.name} 선택 취소`}
                onClick={() => {
                  setError(null);
                  onChange(files.filter((f) => f !== file));
                }}
                style={{ padding: '4px 10px', minHeight: 36 }}
              >
                취소
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
