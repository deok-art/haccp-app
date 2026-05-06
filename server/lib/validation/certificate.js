// server/lib/validation/certificate.js
// 성적서(certificate) 데이터 검증. 순수 함수 — todayStr를 매개변수로 받는다.

const { isBlankRequiredValue, dateDiffDays } = require('./helpers');

function getCertificateAreaCriteria(row, sample) {
  const byArea = row && (row.criteriaByArea || row.criteria_by_area);
  const area = sample && sample.area;
  return byArea && area && byArea[area] ? byArea[area] : null;
}

function getCertificateExpectedJudgement(row, result, sample = null) {
  const areaCriteria = getCertificateAreaCriteria(row, sample);
  const effectiveRow = areaCriteria ? { ...row, ...areaCriteria } : row;
  const value = String(result.value || '').trim();
  if (effectiveRow.input_mode === 'pass_fail') {
    if (value === '적합') return '적';
    if (value === '부적합') return '부';
    if (result.judgement === '적') return '적';
    if (result.judgement === '부') return '부';
    return '';
  }
  if (effectiveRow.input_mode === 'positive_negative') {
    if (value === '음성' || value === '불검출') return '적';
    if (value === '양성' || value === '검출') return '부';
    return '';
  }
  if (effectiveRow.input_mode === 'numeric_range') {
    if (isBlankRequiredValue(value)) return '';
    const num = Number.parseFloat(value);
    if (!Number.isFinite(num)) return '';
    const minOk = effectiveRow.min === undefined || effectiveRow.min === null || num >= Number(effectiveRow.min);
    const maxOk = effectiveRow.max === undefined || effectiveRow.max === null || num <= Number(effectiveRow.max);
    return minOk && maxOk ? '적' : '부';
  }
  return ['적', '부'].includes(result.judgement) ? result.judgement : '';
}

function validateCertificateData(data, certificateSpec, todayStr) {
  const certificate = data.certificate && typeof data.certificate === 'object' ? data.certificate : null;
  if (!certificate) return '성적서 데이터를 입력해주세요.';

  const fields = certificate.fields && typeof certificate.fields === 'object' ? certificate.fields : {};
  const requiredFields = (certificateSpec.topFields || []).filter(field => field.required);
  for (const field of requiredFields) {
    if (isBlankRequiredValue(fields[field.key])) return `${field.label || field.key}을(를) 입력해주세요.`;
  }
  if (fields.samplingDate && dateDiffDays(fields.samplingDate, todayStr) < 0) return '채취일자는 오늘 이후로 선택할 수 없습니다.';
  if (fields.inspectionDate && dateDiffDays(fields.inspectionDate, todayStr) < 0) return '검사일자는 오늘 이후로 선택할 수 없습니다.';
  if (certificate.judgementDate && dateDiffDays(certificate.judgementDate, todayStr) < 0) return '판정일자는 오늘 이후로 선택할 수 없습니다.';
  if (fields.inspectionDate && fields.samplingDate && dateDiffDays(fields.samplingDate, fields.inspectionDate) < 0) {
    return '검사일자는 채취일자보다 빠를 수 없습니다.';
  }
  const judgementOffsetDays = Number(certificateSpec.judgementOffsetDays || 2);
  const judgementGap = dateDiffDays(fields.inspectionDate, certificate.judgementDate);
  if (judgementGap === null || judgementGap < judgementOffsetDays) {
    return `판정일자는 검사일자보다 최소 ${judgementOffsetDays}일 이상 늦어야 합니다.`;
  }

  const samples = Array.isArray(certificate.samples) ? certificate.samples : [];
  if (!samples.length) return '채취대상을 1개 이상 입력해주세요.';

  const rows = Array.isArray(certificateSpec.resultRows) ? certificateSpec.resultRows : [];
  const usesCertificatePhotos = certificateSpec.photoMode === 'certificate';
  if (usesCertificatePhotos) {
    const photos = Array.isArray(certificate.photos) ? certificate.photos : [];
    const maxPhotos = Number(certificateSpec.maxPhotos || 5);
    if (!photos.length) return '성적서 사진을 1장 이상 첨부해주세요.';
    if (photos.length > maxPhotos) return `성적서 사진은 ${maxPhotos}장까지 첨부할 수 있습니다.`;
  }
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] || {};
    const sampleLabelName = certificateSpec.sampleLabel || '채취대상';
    const sampleLabel = sample.target || `${sampleLabelName} ${i + 1}`;
    if (certificateSpec.personLabel && isBlankRequiredValue(sample.personName)) return `[${certificateSpec.personLabel} ${i + 1}] ${certificateSpec.personLabel}을 입력해주세요.`;
    if (isBlankRequiredValue(sample.target)) return `[${sampleLabelName} ${i + 1}] ${sampleLabelName}을(를) 입력해주세요.`;
    if (!usesCertificatePhotos) {
      const photos = Array.isArray(sample.photos) ? sample.photos : [];
      if (!photos.length) return `[${sampleLabel}] 사진을 1장 이상 첨부해주세요.`;
      if (photos.length > 5) return `[${sampleLabel}] 사진은 5장까지 첨부할 수 있습니다.`;
    }
    const results = sample.results && typeof sample.results === 'object' ? sample.results : {};
    let hasSampleFailure = false;
    for (const row of rows) {
      const result = results[row.key] || {};
      if (isBlankRequiredValue(result.value)) return `[${sampleLabel}] ${row.label} 검사결과를 입력해주세요.`;
      const expectedJudgement = getCertificateExpectedJudgement(row, result, sample);
      if (!expectedJudgement) return `[${sampleLabel}] ${row.label} 검사결과가 올바르지 않습니다.`;
      if (result.judgement !== expectedJudgement) return `[${sampleLabel}] ${row.label} 판정결과가 검사결과와 일치하지 않습니다.`;
      if (expectedJudgement === '부') hasSampleFailure = true;
      if (certificateSpec.defectMode !== 'sample' && row.require_defect_text_on_fail && expectedJudgement === '부' && isBlankRequiredValue(result.defectText)) {
        return `[${sampleLabel}] ${row.label} 부적합사항을 입력해주세요.`;
      }
    }
    if (certificateSpec.defectMode === 'sample' && hasSampleFailure) {
      if (isBlankRequiredValue(sample.defectText)) return `[${sampleLabel}] 부적합사항을 입력해주세요.`;
      if (isBlankRequiredValue(sample.actionText)) return `[${sampleLabel}] 개선조치를 입력해주세요.`;
    }
  }

  const expectedOverall = samples.every(sample => rows.every(row => {
    const result = ((sample.results && sample.results[row.key]) || {});
    return getCertificateExpectedJudgement(row, result, sample) === '적';
  })) ? '적합' : '부적합';
  if (certificate.overallJudgement !== expectedOverall) {
    return '종합판정이 검사결과와 일치하지 않습니다.';
  }
  if (expectedOverall === '부적합' && certificateSpec.defectMode !== 'sample') {
    if (isBlankRequiredValue(certificate.defectText)) return '종합판정 부적합 사유를 입력해주세요.';
    if (isBlankRequiredValue(certificate.actionText)) return '종합판정 개선조치를 입력해주세요.';
  }
  return '';
}

module.exports = {
  validateCertificateData,
  getCertificateExpectedJudgement,
  getCertificateAreaCriteria,
};
