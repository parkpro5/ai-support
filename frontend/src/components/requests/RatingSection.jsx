import { useState } from 'react';
import { parseApiError, rateRequest } from '../../api/requests.api';
import { formatDateTime } from '../../utils/time';
import Button from '../common/Button';

const SCORES = [1, 2, 3, 4, 5];
const SCORE_HINTS = { 1: '매우 불만족', 2: '불만족', 3: '보통', 4: '만족', 5: '매우 만족' };
const MAX_COMMENT_LENGTH = 200;

/** 점수를 별과 숫자로 함께 보여준다(색·모양만으로 구분하지 않는다). */
function ScoreStars({ score }) {
  return (
    <span aria-label={`5점 만점에 ${score}점`}>
      <span aria-hidden="true" style={{ color: '#b45309', letterSpacing: 2 }}>
        {'★'.repeat(score)}
        <span style={{ color: 'var(--color-border)' }}>{'★'.repeat(5 - score)}</span>
      </span>{' '}
      <strong>{score}점</strong>
    </span>
  );
}

function RatingForm({ requestId, onRated }) {
  const [score, setScore] = useState(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    if (score === null) {
      setError('점수를 선택해 주세요');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      onRated(await rateRequest(requestId, { score, comment }));
    } catch (err) {
      const { status, message, details } = parseApiError(err);
      setError(details.score ?? details.comment ?? message);
      // 이미 남긴 평가(다른 창·기기)는 다시 불러와 표시한다.
      if (status === 409) onRated(null);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <p style={{ margin: '0 0 var(--spacing-3)', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
        처리 결과는 어땠나요? 평가는 한 번만 남길 수 있고 나중에 고칠 수 없습니다.
      </p>

      <fieldset style={{ border: 'none', margin: '0 0 var(--spacing-3)', padding: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 'var(--spacing-1)', padding: 0 }}>
          만족도 <span aria-hidden="true" style={{ color: 'var(--color-danger)' }}>*</span>
        </legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
          {SCORES.map((value) => {
            const selected = score === value;
            return (
              <label
                key={value}
                className="choice-option"
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: 64,
                  minHeight: 'var(--touch-target)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius)',
                  border: selected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  background: selected ? 'var(--color-bg)' : 'var(--color-surface)',
                  fontWeight: selected ? 700 : 400,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="radio"
                  name="score"
                  value={value}
                  checked={selected}
                  onChange={() => {
                    setScore(value);
                    setError(null);
                  }}
                  style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
                />
                <span aria-hidden="true">{'★'.repeat(value)}</span>
                <span style={{ fontSize: '0.8rem' }}>
                  {value}점 · {SCORE_HINTS[value]}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label htmlFor="rating-comment" style={{ display: 'block', fontWeight: 600, marginBottom: 'var(--spacing-1)' }}>
        한 줄 후기 (선택)
      </label>
      <input
        id="rating-comment"
        type="text"
        value={comment}
        maxLength={MAX_COMMENT_LENGTH}
        onChange={(e) => setComment(e.target.value)}
        placeholder="좋았던 점이나 아쉬웠던 점을 한 줄로 적어 주세요"
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          minHeight: 'var(--touch-target)',
        }}
      />

      {error && (
        <p role="alert" style={{ margin: 'var(--spacing-2) 0 0', color: 'var(--color-danger)', fontSize: '0.9rem' }}>
          {error}
        </p>
      )}

      <div style={{ marginTop: 'var(--spacing-3)' }}>
        <Button type="submit" loading={submitting}>
          평가 남기기
        </Button>
      </div>
    </form>
  );
}

/**
 * 완료된 요청서의 만족도. 작성자는 한 번 입력할 수 있고, 남긴 뒤에는 모두(볼 수 있는 사람) 표시만 한다.
 * 보여줄 것이 없으면 아무것도 그리지 않는다.
 * @param {{ item: object, onRated: (updated: object|null) => void }} props
 *   onRated: 평가를 남기면 갱신된 요청서로, 이미 평가가 있어 409였다면 null로(다시 불러오기) 호출한다.
 */
export default function RatingSection({ item, onRated, style }) {
  if (item.status !== 'COMPLETED' || (!item.rating && !item.canRate)) return null;

  return (
    <section style={style} aria-label="만족도 평가">
      <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>만족도 평가</h2>
      {item.rating ? (
        <div>
          <ScoreStars score={item.rating.score} />
          <p style={{ margin: 'var(--spacing-2) 0 0', wordBreak: 'break-word' }}>
            {item.rating.comment ?? <span style={{ color: 'var(--color-text-muted)' }}>남긴 후기가 없습니다.</span>}
          </p>
          <p style={{ margin: 'var(--spacing-1) 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            {formatDateTime(item.rating.createdAt)}
          </p>
        </div>
      ) : (
        <RatingForm requestId={item.id} onRated={onRated} />
      )}
    </section>
  );
}
