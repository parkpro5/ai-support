import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  createRequest,
  deleteRequest,
  fetchRequest,
  fetchSupportTypes,
  parseApiError,
  updateRequest,
} from '../api/requests.api';
import { uploadAttachments } from '../api/attachments.api';
import AttachmentList from '../components/attachments/AttachmentList';
import FilePicker from '../components/attachments/FilePicker';
import { useAuth } from '../hooks/useAuth';
import { URGENCY_LABELS, URGENCY_OPTIONS } from '../constants/requestLabels';
import Button from '../components/common/Button';
import ConfirmDialog from '../components/common/ConfirmDialog';
import FormField from '../components/common/FormField';
import LinkButton from '../components/common/LinkButton';
import Spinner from '../components/common/Spinner';

const EMPTY_FORM = {
  supportTypeId: '',
  title: '',
  content: '',
  department: '',
  contactName: '',
  contactPhone: '',
  interviewAt: '',
  desiredDate: '',
  urgency: 'NORMAL',
};

const REQUIRED_MESSAGES = {
  supportTypeId: '지원 유형을 선택하세요',
  title: '제목 항목을 입력해 주세요',
  content: '요청 내용 항목을 입력해 주세요',
  department: '소속 항목을 입력해 주세요',
  contactName: '담당자 항목을 입력해 주세요',
  contactPhone: '연락처 항목을 입력해 주세요',
  interviewAt: '착수(인터뷰) 일시를 입력하세요',
  desiredDate: '희망 완료일을 입력하세요',
};

/** ISO 시각을 <input type="datetime-local"> 값(브라우저 로컬 시각)으로 바꾼다. */
function toLocalInput(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formFromRequest(request) {
  return {
    supportTypeId: request.supportType?.id ?? '',
    title: request.title,
    content: request.content,
    department: request.department,
    contactName: request.contactName,
    contactPhone: request.contactPhone ?? '',
    interviewAt: toLocalInput(request.interviewAt),
    desiredDate: request.desiredDate,
    urgency: request.urgency,
  };
}

/** 서버로 보낼 값. 로컬 일시는 UTC ISO로 바꾸고 문자열은 앞뒤 공백을 뺀다. */
function toPayload(form) {
  return {
    supportTypeId: form.supportTypeId,
    title: form.title.trim(),
    content: form.content.trim(),
    department: form.department.trim(),
    contactName: form.contactName.trim(),
    contactPhone: form.contactPhone.trim(),
    interviewAt: new Date(form.interviewAt).toISOString(),
    desiredDate: form.desiredDate,
    urgency: form.urgency,
  };
}

function validateRequired(form) {
  const errors = {};
  for (const [field, message] of Object.entries(REQUIRED_MESSAGES)) {
    if (!String(form[field] ?? '').trim()) errors[field] = message;
  }
  if (form.interviewAt && Number.isNaN(new Date(form.interviewAt).getTime())) {
    errors.interviewAt = '착수(인터뷰) 일시를 올바르게 입력하세요';
  }
  return errors;
}

export default function RequestEditorPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  // 다른 화면(요청서 제출 직후의 파일 업로드 실패 등)에서 넘어오며 남긴 알림
  const location = useLocation();
  const [notice, setNotice] = useState(location.state?.notice ?? null);

  const [files, setFiles] = useState([]); // 이번에 새로 올릴 파일(아직 업로드 전)
  const [attachments, setAttachments] = useState([]); // 이미 올려 둔 요청서 첨부파일
  const [form, setForm] = useState(EMPTY_FORM);
  const [supportTypes, setSupportTypes] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [notEditable, setNotEditable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const types = fetchSupportTypes();
    const request = isEdit ? fetchRequest(id) : Promise.resolve(null);

    Promise.all([types, request])
      .then(([typeList, existing]) => {
        if (cancelled) return;
        // 이미 사용 중지된 유형으로 만든 요청서는 그 유형이 선택 목록에 없어 빈 칸으로 보이므로, 현재 유형을 목록에 포함한다.
        const current = existing?.supportType;
        setSupportTypes(current && !typeList.some((t) => t.id === current.id) ? [...typeList, current] : typeList);
        if (existing) {
          if (!existing.canEdit) setNotEditable(true);
          else {
            setForm(formFromRequest(existing));
            setAttachments(existing.attachments.filter((file) => file.kind === 'request'));
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(parseApiError(err).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, isEdit]);

  // 지원자는 요청서를 작성하지 않는다.
  if (!isEdit && user?.role === 'SUPPORTER') return <Navigate to="/requests" replace />;

  function setField(field) {
    return (e) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
      if (fieldErrors[field]) setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    const errors = validateRequired(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      e.currentTarget.elements[Object.keys(errors)[0]]?.focus();
      return;
    }

    setSaving(true);
    try {
      const payload = toPayload(form);
      const saved = isEdit ? await updateRequest(id, payload) : await createRequest(payload);
      const requestId = isEdit ? id : saved.id;

      // 요청서를 저장한 뒤 파일을 올린다(파일은 요청서 id가 있어야 올릴 수 있다).
      if (files.length > 0) {
        const { uploaded, failed } = await uploadAttachments(requestId, 'request', files);
        if (failed.length > 0) {
          const names = failed.map((entry) => `${entry.file.name}(${entry.message})`).join(', ');
          const text = `요청서는 ${isEdit ? '저장' : '제출'}되었지만 파일 ${failed.length}개를 올리지 못했습니다: ${names}`;
          if (!isEdit) {
            // 이미 만들어진 요청서이므로 다시 제출하지 않게 수정 화면으로 보내 파일만 다시 올리게 한다.
            navigate(`/requests/${requestId}/edit`, { replace: true, state: { notice: { type: 'error', text } } });
            return;
          }
          setAttachments((prev) => [...prev, ...uploaded]);
          setFiles(failed.map((entry) => entry.file));
          setFormError(text);
          return;
        }
      }
      navigate('/requests', { replace: true });
    } catch (err) {
      const { message, details } = parseApiError(err);
      const known = Object.fromEntries(Object.entries(details).filter(([field]) => field in EMPTY_FORM));
      setFieldErrors(known);
      setFormError(Object.keys(known).length > 0 ? '입력한 내용을 확인해주세요.' : message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await deleteRequest(id);
      navigate('/requests', { replace: true });
    } catch (err) {
      setConfirmingDelete(false);
      setFormError(parseApiError(err).message);
    }
  }

  if (loading) return <Spinner />;

  if (loadError) {
    return (
      <div role="alert">
        <p style={{ color: 'var(--color-danger)' }}>{loadError}</p>
        <Link className="tap-link" to="/requests">목록으로</Link>
      </div>
    );
  }

  if (notEditable) {
    return (
      <div>
        <p>이미 접수되었거나 작성자가 아니라서 이 요청서는 수정할 수 없습니다.</p>
        <Link className="tap-link" to="/requests">목록으로</Link>
      </div>
    );
  }

  // name은 검증 실패 시 첫 오류 항목으로 포커스를 옮기는 데 쓴다. (id는 FormField가 라벨과 연결한다.)
  const control = (field) => ({ name: field, value: form[field], onChange: setField(field) });

  return (
    <div>
      <h1 style={{ fontSize: '1.3rem', marginBottom: 'var(--spacing-3)' }}>
        {isEdit ? '요청서 수정' : 'AI 전환 지원요청서 작성'}
      </h1>

      {notice && (
        <p role="alert" style={{ color: notice.type === 'error' ? 'var(--color-danger)' : '#166534', maxWidth: 640 }}>
          {notice.text}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate style={{ maxWidth: 640 }}>
        <FormField label="지원 유형" required error={fieldErrors.supportTypeId}>
          {(a11y) => (
            <select {...a11y} {...control('supportTypeId')}>
              <option value="">선택하세요</option>
              {supportTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField label="제목" required error={fieldErrors.title}>
          {(a11y) => <input type="text" maxLength={200} {...a11y} {...control('title')} />}
        </FormField>

        <FormField label="요청 내용" required error={fieldErrors.content} hint="어떤 업무를 어떻게 도와주길 원하는지 적어주세요.">
          {(a11y) => (
            <textarea rows={6} maxLength={5000} {...a11y} {...control('content')} style={{ ...a11y.style, resize: 'vertical' }} />
          )}
        </FormField>

        <FormField label="소속" required error={fieldErrors.department}>
          {(a11y) => <input type="text" maxLength={100} {...a11y} {...control('department')} />}
        </FormField>

        <FormField label="담당자" required error={fieldErrors.contactName}>
          {(a11y) => <input type="text" maxLength={50} {...a11y} {...control('contactName')} />}
        </FormField>

        <FormField
          label="연락처"
          required
          error={fieldErrors.contactPhone}
          hint="작성자, 담당 지원자, 관리자에게만 보입니다."
        >
          {(a11y) => <input type="tel" maxLength={30} {...a11y} {...control('contactPhone')} />}
        </FormField>

        <FormField label="착수(인터뷰) 일시" required error={fieldErrors.interviewAt}>
          {(a11y) => <input type="datetime-local" {...a11y} {...control('interviewAt')} />}
        </FormField>

        <FormField label="희망 완료일" required error={fieldErrors.desiredDate}>
          {(a11y) => <input type="date" {...a11y} {...control('desiredDate')} />}
        </FormField>

        <FormField label="긴급도" required error={fieldErrors.urgency}>
          {(a11y) => (
            <select {...a11y} {...control('urgency')}>
              {URGENCY_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {URGENCY_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <section aria-label="첨부파일" style={{ marginBottom: 'var(--spacing-4)' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 var(--spacing-2)' }}>첨부파일 (선택)</h2>
          <AttachmentList
            attachments={attachments}
            deletable
            onDeleted={(deletedId) => setAttachments((prev) => prev.filter((file) => file.id !== deletedId))}
          />
          <FilePicker files={files} onChange={setFiles} existingCount={attachments.length} disabled={saving} />
          {!isEdit && files.length > 0 && (
            <p style={{ margin: 'var(--spacing-2) 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              선택한 파일은 요청서를 제출할 때 함께 올라갑니다.
            </p>
          )}
        </section>

        {formError && (
          <p role="alert" style={{ color: 'var(--color-danger)' }}>
            {formError}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--spacing-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          <Button type="submit" loading={saving}>
            {isEdit ? '저장' : '제출'}
          </Button>
          <LinkButton to="/requests" variant="ghost" aria-disabled={saving || undefined}>
            취소
          </LinkButton>
          {isEdit && (
            <Button type="button" variant="danger" disabled={saving} onClick={() => setConfirmingDelete(true)} style={{ marginLeft: 'auto' }}>
              삭제
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmingDelete}
        title="요청서 삭제"
        message="이 요청서를 삭제할까요? 삭제하면 되돌릴 수 없습니다."
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
