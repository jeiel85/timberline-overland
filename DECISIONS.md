# Decisions

되돌리기 어려운 결정(데이터 형식·주요 의존성·공개 약속)만 적습니다.

## 2026-11-06 · 앱 식별자(manifest `id`)는 `/timberline-overland/`

**배경** — `manifest.webmanifest`의 `"id": "./"`는 manifest 위치가 아니라 **start_url의 출처**(`https://jeiel85.github.io`) 기준으로 풀려 `https://jeiel85.github.io/`가 된다. 같은 출처의 다른 Pages 게임 8개도 `"./"`라 Chrome은 이들을 모두 같은 앱으로 봤다. 한 게임이 설치돼 있으면 다른 게임에서 설치 제안이 나오지 않고, 설치된 앱의 시작 주소가 다른 게임으로 덮어써지기도 했다. Chrome DevTools `Page.getAppId`도 `/timberline-overland/`를 권한다.

**고른 것** — `"id": "/timberline-overland/"`. 출처 안에서 이 게임만의 경로라 겹치지 않는다. `tests/pwa.test.mjs`가 이 값을 지킨다.

**고르지 않은 것**
- id 빼기 — start_url(`./`)이 id가 되어 지금 값은 같지만, start_url에 쿼리를 붙이는 순간 앱 정체성이 바뀐다.

**결과**
- id는 앱의 정체성이라 바꾸면 이미 설치한 앱이 새 manifest를 받지 못하고 새 앱으로 다시 설치해야 한다. 이번 변경 전에 설치한 앱도 그렇다(옛 앱을 지우고 다시 설치). 옛 id는 다른 앱과 겹쳐 있어 어차피 바로잡아야 했다. 저장(localStorage)은 출처 단위라 영향이 없다.
- 서비스 워커는 같은 출처 파일을 네트워크 우선으로 받으므로 바꾸지 않았다. 고친 manifest는 Pages의 HTTP 캐시(10분)가 지나면 닿는다.

## 2026-11-04 · 3D 오브젝트는 Blender로 설계하고 three.js 코드로 옮긴다

**배경** — 랜드마크 일부(옛 광산, 설선 대피소, 호수 선착장)가 게임 안에서 미흡해 보강이 필요했고, 로컬 Blender 5.2와 `scenario-blender-*` 스킬을 쓸 수 있게 됐다. README와 소개글은 "외부 에셋 파일 없이 지형·차량·건물·소리를 전부 코드로 생성"(100% procedural)을 내세운다.

**고른 것 — A. Blender는 설계·검증 도구, 게임에는 코드만**
Blender에서 실제 지형 단면(`generateTerrain()` 샘플) 위에 같은 치수의 프리미티브로 블록아웃하고 렌더로 비례·실루엣·지형 접합을 확인한 뒤, 같은 형태를 `src/props.js`의 three.js 코드(Box·Cylinder·Extrude·매개변수 메시·캔버스 텍스처)로 옮긴다. 저장소에는 .blend·.glb 같은 에셋 파일을 넣지 않는다.

**고르지 않은 것**
- B. Blender에서 GLB를 내보내 GLTFLoader로 싣기 — 표현력은 가장 높지만 "외부 에셋 없음" 문구(README 배지·소개글)가 틀려지고, GLTFLoader 애드온과 .glb를 `sw.js` 사전 캐시·`tests/pwa.test.mjs`에 추가해야 하며, 비동기 로딩 단계·실패 처리와 다운로드 크기가 늘어난다.
- C. Blender 메시를 정점 배열 JS 모듈로 굽기 — 파일 형식상으로는 "코드"지만 실제로는 구운 데이터라 "코드로 생성"이라는 설명과 어긋나고, diff를 읽을 수 없다.

**결과**
- 오프라인 캐시 목록·테스트·의존성은 바뀌지 않는다.
- 형태는 코드로 표현할 수 있는 범위(프리미티브, 회전체·돌출, 매개변수 곡면)로 제한된다. 베벨·불리언·스컬프트 결과를 그대로 쓰려면 이 결정을 다시 열어야 한다(B로 전환 시 README·sw.js·pwa 테스트를 함께 갱신).
