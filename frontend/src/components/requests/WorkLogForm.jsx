import { useState } from 'react';
import Button from '../common/Button';
import FormField from '../common/FormField';
import LinkButton from '../common/LinkButton';
import { formatMinutes } from '../../utils/time';

const MAX_MINUTES = 10000;

/** 소요 시간 입력값(문자열)을 정수 분으로 바꾼다. 올바르지 않으면 null. */
function parseMinutes(value) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function validate({ content, minutes }) {
  const errors = {};
  if (!content.trim()) errors.content = '작업 내용 항목을 입력해 주세요';
  if (!String(minutes).trim()) errors.minutes = '소요 시간(분)을 입력해 주세요';
  else {
    const value = parseMinutes(minutes);
    if (value === null) errors.minutes = '소요 시간(분)은 0 이상의 정수로 입력해 주세요';
    else if (value > MAX_MINUTES) errors.minutes = `소요 시간(분)은 ${MAX_MINUTES}분 이하로 입력해 주세요`;
  }
  return errors;
}

/**
 * 작업내역 입력 폼.
 * @param {{ onSubmit: (body: { content: string, minutes: number }) => Promise<void>, cancelTo: string, submitLabel?: string, initialContent?: string }} props
 *   initialContent: 재작업처럼 이전 내용을 고쳐 쓰는 경우 미리 채워 둘 작업 내용. 소요 시간은 이번 회차 기준이라 비워 둔다.
 *   onSubmit이 던진 오류는 `{ message, details }` 형태(parseApiError 결과)로 받아 항목별로 보여준다.
 */
export default function WorkLogForm({ onSubmit, cancelTo, submitLabel = '작업내역 제출', initialContent = '' }) {
  const [form, setForm] = useState({ content: initialContent, minutes: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  function setField(field) {
    return (e) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      e.currentTarget.elements[Object.keys(errors)[0]]?.focus();
      return;
    }

    setSaving(true);
    try {
      await onSubmit({ content: form.content.trim(), minutes: parseMinutes(form.minutes) });
    } catch (err) {
      const known = Object.fromEntries(Object.entries(err.details ?? {}).filter(([field]) => field in form));
      setFieldErrors(known);
      setFormError(Object.keys(known).length > 0 ? '입력한 내용을 확인해 주세요.' : err.message);
    } finally {
      setSaving(false);
    }
  }

  const preview = formatMinutes(parseMinutes(form.minutes) ?? -1);

  return (
    <form onSubmit={handleSubmit} noValidate style={{ maxWidth: 640 }}>
      <FormField label="작업 내용" required error={fieldErrors.content} hint="무엇을 어떻게 처리했는지 적어 주세요.">
        {(a11y) => (
          <textarea
            rows={8}
            maxLength={5000}
            name="content"
            value={form.content}
            onChange={setField('content')}
            {...a11y}
            style={{ ...a11y.style, resize: 'vertical' }}
          />
        )}
      </FormField>

      <FormField
        label="소요 시간(분)"
        required
        error={fieldErrors.minutes}
        hint={preview ? `${preview}으로 기록됩니다.` : '분 단위 숫자로 입력해 주세요. 예: 1시간 30분이면 90'}
      >
        {(a11y) => (
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_MINUTES}
            step={1}
            name="minutes"
            value={form.minutes}
            onChange={setField('minutes')}
            {...a11y}
          />
        )}
      </FormField>

      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
        제출하면 요청자 확인으로 넘어가며, 제출 후에는 이 화면에서 수정할 수 없습니다.
      </p>

      {formError && (
        <p role="alert" style={{ color: 'var(--color-danger)' }}>
          {formError}
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap' }}>
        <Button type="submit" loading={saving}>
          {submitLabel}
        </Button>
        <LinkButton to={cancelTo} variant="ghost" aria-disabled={saving || undefined}>
          취소
        </LinkButton>
      </div>
    </form>
  );
}
