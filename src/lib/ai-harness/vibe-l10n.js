/**
 * Korean translations for the Vibe panel's react-intl messages.
 *
 * The components declare English via `defaultMessage`; scratch-l10n has no entries
 * for our custom `vibe.*` ids, so a Korean-locale editor falls back to English and
 * react-intl logs a "Missing message" warning per id. This file supplies the ko
 * strings, merged into the IntlProvider messages in connected-intl-provider.jsx.
 * English stays the default for every other locale (additive, not a replacement).
 *
 * KEEP IN SYNC with the defineMessages() blocks in src/components/vibe-prompt/*
 * and src/containers/vibe-prompt.jsx. test/unit/ai-harness/vibe-l10n.test.js
 * asserts every `vibe.*` id used in those files has a non-empty key here.
 *
 * `vibe.prompt.title` is intentionally left as the English brand name.
 */

const ko = {
    // --- vibe-prompt panel ---
    'vibe.prompt.title': 'Vibe Block Coding',
    'vibe.prompt.collapse': '접기',
    'vibe.prompt.expand': '펼치기',
    'vibe.prompt.back': '뒤로',
    'vibe.prompt.send': '보내기',
    'vibe.prompt.instructionPlaceholder': '만들고 싶은 걸 말해 보세요…',
    'vibe.prompt.working': '생각 중…',
    'vibe.prompt.error': '앗, 잘 안 됐어요. 다시 해볼까요?',
    'vibe.prompt.tryAgain': '다시 하기',
    'vibe.prompt.toggleExamples': '예시 보기',
    'vibe.prompt.dismissExamples': '예시 닫기',
    'vibe.prompt.sheetCaption': '이렇게 말해 보세요…',
    'vibe.prompt.welcomeTitle': '무엇을 만들까요?',
    'vibe.prompt.welcomeSubtitle': '이렇게 말해 보세요…',
    'vibe.prompt.chipWalk': '걸어다니기',
    'vibe.prompt.chipSpin': '계속 돌기',
    'vibe.prompt.chipHello': '인사하기',
    // --- conversation memory ---
    'vibe.prompt.memoryLabel': '💬 대화 기억',
    'vibe.prompt.memoryHint': 'AI가 기억하는 지난 대화 수예요.',
    // --- bring-your-own-key ---
    'vibe.prompt.keyPlaceholder': 'API 키를 붙여넣으세요 (sk-ant-...)',
    'vibe.prompt.keyNotice': '키는 이 브라우저에만 저장돼요. 예산이 낮은 키를 쓰세요.',
    'vibe.prompt.saveKey': '키 저장',
    'vibe.prompt.resetKey': 'API 키 변경',
    'vibe.prompt.saveKeyError': '이 브라우저에 키를 저장하지 못했어요. 다시 해볼까요?',
    // --- connection modes ---
    'vibe.prompt.connMethod': '연결 방법',
    'vibe.prompt.connFree': '무료',
    'vibe.prompt.connKey': '내 키',
    'vibe.prompt.connServer': '커스텀 서버',
    'vibe.prompt.freeIntro': '키가 필요 없어요. 바로 만들기를 시작해요!',
    'vibe.prompt.startFree': '시작',
    'vibe.prompt.serverUrlPlaceholder': '서버 주소 (https://…)',
    'vibe.prompt.serverTokenPlaceholder': '토큰 (선택)',
    'vibe.prompt.serverNotice': '토큰은 이 주소로 전송되고 이 브라우저에 저장돼요.',
    'vibe.prompt.saveServer': '서버 저장',
    'vibe.prompt.freeLimited': '지금은 무료 데모가 붐벼요. 계속하려면 내 키를 넣어 주세요.',
    'vibe.prompt.useOwnKey': '내 키 쓰기',
    // --- AGPL source offer (settings screen footer) ---
    'vibe.prompt.sourceLink': '소스 코드 (AGPL-3.0)',
    // --- history ---
    'vibe.prompt.historyClear': '기록 지우기',
    'vibe.prompt.historyNote': '이 브라우저에만 있어요. 프로젝트에는 저장되지 않아요.',
    'vibe.prompt.makeIt': '🧩 만들기',
    // --- proposal card ---
    'vibe.proposal.apply': '적용',
    'vibe.proposal.ignore': '무시',
    'vibe.proposal.rebuild': '다시 만들기',
    'vibe.proposal.applied': '✓ 적용됨',
    'vibe.proposal.ignored': '무시됨',
    'vibe.proposal.stale': '작업 영역이 바뀌었어요',
    'vibe.proposal.removes': '블록 묶음 {count}개를 지워요.'
};

export default {ko};
