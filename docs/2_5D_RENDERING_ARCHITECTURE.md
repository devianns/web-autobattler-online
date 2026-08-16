# 2.5D Game Client and Rendering Architecture

이 문서는 Web Autobattler Online의 2.5D 게임 화면에 관한 기준 명세다. 목표는 롤토체스처럼 고정된 대각선 카메라에서 3D 캐릭터가 격자 보드 위를 이동하고 싸우는 화면을 웹 브라우저에서 구현하는 것이다.

## 1. 핵심 결정

실제 월드와 유닛은 3D로 렌더링하지만 게임 판정은 8×8 정수 격자에서만 수행한다.

- **전투 엔진**은 이동, 사거리, 타깃, 공격, 피해와 승패를 결정한다.
- **Three.js 렌더러**는 결정된 결과와 이벤트를 화면에 표현한다.
- **React UI**는 상점, 벤치, HUD, 툴팁, 로비와 결과창을 담당한다.
- **Neon/Vercel**은 권위 상태, 전투 입력, 결과와 이벤트 장부를 보관한다.
- 렌더링 프레임, 애니메이션 길이와 물리 표현은 서버 판정에 영향을 주지 않는다.

이 프로젝트에서 2.5D는 2D 스프라이트에 원근을 흉내 내는 방식이 아니라, 제한된 카메라와 격자 규칙을 사용하는 실제 3D 장면을 뜻한다.

## 2. 기술 스택

| 영역 | 기술 | 역할 |
| --- | --- | --- |
| 앱과 UI | Next.js, React, TypeScript | 페이지, HTML UI와 API 연결 |
| 3D 연결 | React Three Fiber | React 방식의 Three.js 장면 구성 |
| 3D 코어 | Three.js | WebGL, 카메라, 조명, GLTF와 animation |
| 보조 기능 | `@react-three/drei` | `useGLTF`, 카메라 등 검증된 helper |
| 판정 | 순수 TypeScript | 결정론적 격자 전투 엔진 |
| 에셋 | GLB/glTF | 캐릭터, 보드와 animation clip |

다음은 MVP에서 사용하지 않는다.

- PixiJS와 Phaser: 2D/3D 렌더러 이중 운영 방지
- Rapier와 Cannon: 격자 엔진과 물리 판정의 이중화 방지
- 무거운 post-processing: 기본 전투 완성 이후에만 검토
- Canvas 기반 상점/HUD: HTML 접근성과 개발 효율을 유지

R3F Canvas는 Client Component로 만들고 필요하면 dynamic import로 SSR을 끈다. 전투 엔진은 DOM, React와 Three.js를 import하지 않아 Vercel 함수와 테스트에서 실행 가능해야 한다.

## 3. 계층별 책임

```text
React HTML UI
├─ 로비와 매칭
├─ 상점, 벤치, 골드와 XP
├─ 타이머, 플레이어 목록, 툴팁과 결과
└─ 폴링, 명령 전송과 오류 표시

React Three Fiber / Three.js
├─ 보드, 배경, 카메라와 조명
├─ 유닛 모델과 animation
├─ 투사체, particle과 체력 UI anchor
└─ raycasting 기반 셀·유닛 선택

순수 TypeScript 전투 엔진
├─ 100ms 논리 tick
├─ 타깃, 이동, 공격, 피해, 마나와 스킬
├─ 승패와 플레이어 피해
└─ 시간 정보가 포함된 CombatEvent 생성

Neon / Vercel
├─ 명령 검증과 멱등 처리
├─ 전투 입력 snapshot
└─ 결과와 event ledger
```

금지되는 의존 방향:

- 전투 엔진이 React나 Three.js를 import하면 안 된다.
- 서버가 animation clip 이름이나 particle 수를 판정 데이터로 사용하면 안 된다.
- 클라이언트 충돌, tween 완료와 animation callback이 승패를 바꾸면 안 된다.
- DB Unit 객체를 Three.js Object3D처럼 직접 변경하면 안 된다.

## 4. 화면 구조

```text
GamePage (position: relative)
├─ BattleCanvas
├─ TopHUD
├─ PlayerList
├─ ShopPanel
├─ BenchPanel
├─ UnitTooltip
├─ ConnectionStatus
└─ ResultOverlay
```

- Canvas는 보드와 월드를 그린다.
- HTML UI는 Canvas 위에 overlay한다.
- HUD 영역에서는 HTML이 pointer event를 우선한다.
- 로비와 단독 결과 화면에서는 Canvas를 mount하지 않는다.
- Canvas가 실패해도 연결 오류와 재시도 버튼은 HTML 계층에 남는다.
- 데스크톱이 초기 대상이지만 작은 화면에서도 HUD가 보드를 완전히 가리지 않도록 최소 해상도와 축소 정책을 둔다.

권장 폴더:

```text
src/
├─ components/game-ui/
├─ rendering/
│  ├─ BattleCanvas.tsx
│  ├─ scene/
│  ├─ units/
│  ├─ effects/
│  ├─ playback/
│  ├─ assets/
│  └─ coordinates/
├─ game/engine/
├─ game/events/
└─ server/
```

## 5. 좌표계

판정 좌표와 화면 좌표를 분리한다.

```ts
type GridPosition = { x: number; y: number }; // 정수 0..7
type WorldPosition = { x: number; y: number; z: number };

function gridToWorld(position: GridPosition): WorldPosition {
  return {
    x: (position.x - 3.5) * CELL_SIZE,
    y: 0,
    z: (position.y - 3.5) * CELL_SIZE,
  };
}
```

- 논리 `x`는 월드 `x`, 논리 `y`는 월드 `z`에 대응한다.
- 월드 `y`는 높이, 점프, 부유와 이펙트에만 사용한다.
- `CELL_SIZE`는 표현 상수이며 서버 판정과 checksum에 포함하지 않는다.
- 보드 원점, 팀 방향과 카메라 방향은 단일 coordinate adapter에서 처리한다.
- 상대편 시점에서도 DB 좌표를 변경하지 않고 view transform만 적용한다.
- pointer 좌표는 raycast로 board plane과 교차한 뒤 가장 가까운 정수 셀로 변환한다.
- 격자 밖, UI 아래, 가려진 셀은 drop target이 될 수 없다.

필수 테스트:

- 64개 셀의 `gridToWorld`/`worldToGrid` 왕복
- 양 팀 view에서 동일 UID가 올바른 논리 셀을 가리키는지 확인
- 경계와 셀 사이 중앙에서 일관된 반올림

## 6. 카메라와 조명

초기 카메라는 Orthographic Camera로 확정한다. 셀 선택이 명확하고 원근 왜곡이 작으며 미니어처 보드 느낌을 만들기 쉽다. 실제 아트 테스트에서 깊이감이 부족할 경우에만 좁은 FOV의 Perspective Camera를 비교한다.

카메라 정책:

- SHOP과 COMBAT의 기본 위치와 회전은 고정한다.
- 자유 회전과 자유 zoom은 MVP에서 제공하지 않는다.
- 전투 시작, 강한 스킬과 승리 시 작은 zoom 또는 shake만 허용한다.
- 카메라 shake는 사용자 설정으로 끌 수 있어야 한다.
- resize 시 보드가 HUD 안전 영역 안에 들어오도록 zoom을 다시 계산한다.
- 애니메이션 seek 중 카메라 연출은 현재 이벤트 시점에 맞게 재구성하거나 생략한다.

조명 정책:

- ambient 또는 hemisphere light 하나
- 그림자를 만드는 directional light 하나
- 캐릭터 가독성을 위한 단순 rim/fill 표현은 재질 또는 저비용 light로 제한
- 실시간 point light 남발 금지
- Low 품질에서는 그림자 비활성화

## 7. 입력과 배치

보드 입력은 raycasting으로 포인터 아래의 셀 또는 유닛을 찾는다. 서버에는 정수 좌표만 보낸다.

```text
pointer down on unit
  → drag preview 시작
  → raycast로 hover cell 계산
  → 유효 셀 표시
pointer up
  → REQ_MOVE_UNIT(actionId, expectedVersion, x, y)
  → 승인 시 확정
  → 거절 시 서버 snapshot 위치로 복귀
```

- drag preview는 권위 상태가 아니다.
- SHOP 종료 시 입력을 잠그고 진행 중 drag를 취소한다.
- 서버가 phase, 소유권, 용량, 위치와 expectedVersion을 재검증한다.
- 서버 응답 전 같은 유닛에 대한 중복 명령을 막는다.
- 유닛과 셀의 선택 상태를 별도로 두어 향후 키보드 조작을 지원한다.
- 체력바와 이름표는 MVP에서 3D anchor를 화면 좌표로 투영한 HTML overlay로 만든다.

## 8. 렌더링 상태

```ts
interface UnitViewState {
  uid: string;
  worldPosition: [number, number, number];
  facingRadians: number;
  animation: idle | walk | attack | cast | hit | death;
  displayedHp: number;
  visible: boolean;
}
```

- 서버 snapshot을 불변 입력으로 받아 별도 UnitView를 만든다.
- UnitView에는 보간 위치, 표시 HP, animation과 effect 같은 표현 값만 둔다.
- React state를 매 frame 갱신하지 않는다. frame 값은 R3F ref 또는 렌더링 전용 store로 갱신한다.
- 새 state version을 받았다는 이유만으로 진행 중 combat scene을 초기화하지 않는다.
- phase 또는 combat ID가 바뀔 때만 scene 생명주기를 전환한다.
- 서버 snapshot과 최종 view state를 비교해 재생 오류를 진단할 수 있게 한다.

## 9. 전투 이벤트 재생기

```ts
interface PlaybackClock {
  combatId: string;
  serverStartedAt: number;
  localOffsetMs: number;
  playbackRate: number;
  lastAppliedSeq: number;
}
```

재생 절차:

1. combat snapshot으로 UnitView를 생성한다.
2. `serverNow`로 서버와 로컬 시계 차이를 추정한다.
3. `serverStartedAt` 기준 목표 재생 시간을 계산한다.
4. 목표 시간까지 event를 `seq` 순서대로 적용한다.
5. MOVE는 `durationMs` 동안 시작점과 끝점을 보간한다.
6. ATTACK/CAST는 clip을 시작하고 event의 hit 시점에 DAMAGE 표현을 맞춘다.
7. 탭 복귀나 늦은 접속은 모든 frame을 재생하지 않고 목표 시간으로 seek한다.
8. COMBAT_END에서 최종 핵심 상태를 확인하고 결과 UI로 전환한다.

초기 표현 event 계약:

| 이벤트 | 화면 표현 |
| --- | --- |
| `SPAWN` | 모델과 HP UI 생성 |
| `MOVE` | 위치 보간과 walk clip |
| `FACE` | 목표 방향 회전 |
| `ATTACK_START` | attack clip 시작 |
| `PROJECTILE_SPAWN` | 투사체 생성 |
| `DAMAGE` | HP 감소, flash와 피해 숫자 |
| `MANA_CHANGE` | 마나 UI 변경 |
| `CAST_START` | cast clip과 사전 이펙트 |
| `STATUS_APPLY/REMOVE` | 상태 아이콘과 지속 이펙트 |
| `DEATH` | death clip 후 숨김 |
| `COMBAT_END` | 승패 연출과 입력 종료 |

누락된 animation이나 effect 때문에 재생을 멈추지 않는다. `idle` 또는 procedural fallback을 사용하고 다음 `seq`를 계속 처리한다.

## 10. GLB 모델과 애니메이션 계약

3D 에셋 표준은 binary glTF인 `.glb`다.

- 로컬 원점은 캐릭터 발 중앙이다.
- 캐릭터의 기본 전방 축을 전체 프로젝트에서 통일한다.
- 캐릭터가 한 셀 안에 들어오도록 import scale을 표준화한다.
- validation script로 mesh, skeleton, material과 clip 이름을 검사한다.
- 필수 clip은 `idle`, `walk`, `attack`, `hit`, `death`다.
- 선택 clip은 `cast`, `victory`, `spawn`이다.
- clip이 없을 때 사용할 fallback을 presentation 코드에 정의한다.
- 모델 파일에 HP, 공격력, 사거리나 판정 hitbox를 넣지 않는다.
- skin variant는 가능한 한 skeleton과 animation을 공유한다.
- 애니메이션 clip은 불필요한 keyframe을 줄이고 export 설정을 버전 관리한다.

MVP는 완성된 캐릭터 아트보다 capsule과 임시 GLB로 전체 게임을 먼저 완성한다. 최종 모델 교체가 전투 엔진, DB schema 또는 API 변경으로 이어지면 안 된다.

에셋 manifest 예시:

```ts
interface UnitPresentation {
  baseId: string;
  modelUrl: string;
  scale: number;
  yOffset: number;
  clips: Partial<Record<UnitAnimation, string>>;
  basicProjectile?: string;
  abilityEffects: Record<string, string>;
}
```

manifest에는 표현 정보만 두며 balance 수치는 content DB 또는 전투 engine content에서 관리한다.

## 11. 애니메이션 상태 머신

각 유닛 view의 animation 우선순위는 다음과 같다.

```text
death > cast > hit > attack > walk > idle
```

- 상태 전환 시 clip을 짧게 cross-fade한다.
- walk 속도를 실제 이동 표현과 맞추되 도착 시각은 event의 `durationMs`가 우선한다.
- attack clip의 자체 타격 frame을 판정에 사용하지 않는다. event의 `hitAtMs`에 타격 표현을 맞춘다.
- death 이후 동일 유닛을 대상으로 하는 후속 표현 event는 안전하게 무시한다.
- asset이 늦게 로드되어도 playback clock은 기다리지 않는다.
- 0배, 1배와 2배 재생을 지원할 경우 AnimationMixer timeScale과 event clock을 함께 조정한다.
- animation duration이 event duration보다 길면 clip 속도를 조정하거나 안전하게 잘라 다음 상태로 전환한다.

## 12. 이펙트 원칙

MVP는 저비용 표현부터 사용한다.

- 기본 공격: 짧은 model motion과 타격 flash
- 원거리 공격: billboard 또는 작은 mesh 투사체
- 피해: 화면을 향한 숫자와 HP bar 보간
- 범위 스킬: 바닥 decal 또는 반투명 plane
- 폭발: 최대 수가 제한된 sprite particle
- 선택/배치 가능 셀: emissive 또는 overlay plane
- 사망: 고가의 dissolve shader보다 death animation과 fade 우선

서버는 effect 파일명, 색상이나 particle 수를 보내지 않는다. 서버는 `abilityId`와 event 의미만 제공하고 버전된 presentation manifest가 실제 표현을 선택한다.

이펙트 pool을 사용하여 매 공격마다 geometry와 material을 새로 만들지 않는다. 화면 밖이거나 이미 seek로 지나간 cosmetic event는 생략할 수 있지만 HP, 생존과 최종 위치 표현은 목표 시점과 일치해야 한다.

## 13. 그래픽 성능 예산

초기 지원 기준은 데스크톱 Chrome, Edge와 Safari다. 일반 노트북 내장 GPU에서 60fps를 목표로 하며, 부하 시 30fps 아래로 장시간 내려가지 않아야 한다.

| 항목 | MVP 예산 |
| --- | --- |
| 동시 전투 유닛 | 보통 18개, 상한 30개 |
| 주요 조명 | 1개 + ambient/hemisphere |
| 실시간 shadow caster | 주요 유닛과 보드로 제한 |
| 캐릭터 텍스처 | 기본 512~1024px |
| 초기 전투 asset 전송량 | 압축 후 목표 10MB 이하 |
| draw calls | 대표 장면 목표 150 이하 |
| particle | 품질 단계별 상한 적용 |
| frame rate | 60fps 목표, Low에서 최소 30fps |

품질 프리셋:

- **Low**: 낮은 pixel ratio, 그림자 끔, particle 축소, post-processing 없음
- **Medium**: 제한된 그림자와 기본 particle
- **High**: 높은 pixel ratio, 그림자와 추가 cosmetic effect

`devicePixelRatio`를 그대로 무제한 사용하지 않고 상한을 둔다. 사용자가 선택한 품질을 우선하되, 일정 시간 frame budget을 넘으면 동적 품질 저하를 선택적으로 제공할 수 있다.

성능은 감으로 판단하지 않고 다음을 기록한다.

- browser profiler의 CPU/GPU frame time
- `renderer.info`의 draw call, geometry와 texture 수
- GLB 다운로드 및 decode 시간
- 첫 장면 표시와 첫 전투 준비 시간
- maximum-unit fixture의 평균 및 p95 frame time

## 14. 로딩, 캐싱과 실패 대체

- 첫 화면은 로비 asset만 로드한다.
- 매칭이 끝나면 보드, 공통 effect와 등장 가능한 unit model을 preload한다.
- 전투 시작은 모든 cosmetic asset보다 snapshot과 placeholder 준비를 우선한다.
- model fetch 또는 decode 실패 시 baseId별 색상 capsule로 계속 진행한다.
- 동일 base unit의 geometry, material, skeleton과 texture를 재사용한다.
- static filename에는 content hash를 사용해 Vercel CDN에서 장기 cache한다.
- content version과 presentation manifest version을 combat snapshot에 연결한다.
- preload 진행률은 다운로드 byte와 필수 asset 준비 여부를 구분해 표시한다.
- 연결이 느린 사용자가 animation 때문에 game phase 진행을 막지 않는다.

## 15. GPU 리소스 생명주기

Three.js의 GPU resource는 Object3D를 scene에서 제거하는 것만으로 항상 해제되지 않는다.

- 게임 또는 큰 scene을 떠날 때 공유되지 않는 geometry, material, texture와 render target을 dispose한다.
- AnimationMixer action을 멈추고 root와 clip cache를 정리한다.
- event listener, timer와 frame subscription을 cleanup한다.
- 공유 asset cache는 reference count를 사용해 다른 unit이 쓰는 resource를 너무 일찍 해제하지 않는다.
- effect pool과 projectile pool은 round 종료 때 활성 객체를 모두 반환한다.
- 반복 전투 후 `renderer.info.memory`가 계속 증가하지 않는지 soak test로 확인한다.

페이지 이동과 재접속을 반복해도 renderer, canvas 또는 animation loop가 중복 생성되지 않아야 한다.

## 16. 접근성과 사용성

- 팀, 등급과 배치 가능 여부를 색상만으로 구분하지 않고 outline, icon과 형태를 병용한다.
- 카메라 흔들림, 번쩍임, particle과 피해 숫자를 줄이는 설정을 제공한다.
- SHOP의 핵심 조작은 HTML button으로 유지해 키보드와 screen reader 접근을 지원한다.
- 선택한 셀과 유닛은 명확한 outline과 텍스트 정보로 확인할 수 있어야 한다.
- Canvas가 실패해도 reconnect, surrender와 결과 확인 UI는 작동해야 한다.
- 전투 속도 변경과 즉시 결과 보기는 서버 결과에 영향을 주지 않는 편의 기능이다.

## 17. 테스트 전략

### 좌표와 입력

- `gridToWorld`/`worldToGrid` 왕복 fixture
- 양 팀 카메라 방향에서 동일 셀 선택
- board 경계와 HUD 위 pointer 처리
- SHOP 종료와 drag drop이 겹치는 경우
- 서버가 이동을 거절했을 때 원위치 복구

### 재생기

- event seq 누락, 중복과 늦은 도착
- 0%, 50%, 100% 시점 seek 결과 비교
- background tab 복귀 시 목표 시점 catch-up
- model 또는 clip 누락 fallback
- DAMAGE/DEATH 동시 event 순서
- 0배/2배 재생에서 최종 상태 일치

### 시각 및 성능

- model 404와 느린 decode 중 placeholder 진행
- 해상도와 pixel ratio별 board framing
- 30개 unit, projectile와 최대 particle fixture
- 카메라, 셀 정렬, HP bar와 HUD 겹침 screenshot 회귀
- 여러 round 반복 후 GPU resource 증가 여부
- Low/Medium/High 프리셋별 frame budget

## 18. 구현 순서

### R1 — 3D 보드 골격

- R3F Canvas, Orthographic Camera, 8×8 board와 light
- 좌표 adapter와 resize framing
- capsule unit 표시

완료 기준: 모든 논리 셀이 정확한 world 위치에 표시되고 화면 크기가 바뀌어도 board가 UI safe area 안에 들어온다.

### R2 — 배치 입력

- raycasting cell selection
- drag preview와 valid/invalid highlight
- 서버 승인 및 rollback UI

완료 기준: 3D board에서 unit을 배치하고 stale version 또는 phase 종료 거절 시 정확히 복구한다.

### R3 — 이벤트 재생

- fixture 기반 MOVE, FACE, ATTACK, DAMAGE와 DEATH
- playback clock, sequence 처리와 seek
- HP overlay와 기본 projectile

완료 기준: 동일 fixture가 새로고침 전후 같은 전투 시점과 최종 상태로 재생된다.

### R4 — GLB 애니메이션

- asset manifest와 validation
- AnimationMixer state machine
- missing asset/clip fallback

완료 기준: 일부 model 또는 clip이 없어도 placeholder와 fallback으로 combat이 종료된다.

### R5 — 품질과 안정성

- Low/Medium/High preset
- preload, CDN cache와 loading UI
- GPU cleanup과 soak test
- accessibility preference

완료 기준: maximum-unit fixture가 성능 예산을 만족하고 여러 게임을 반복해도 GPU memory가 지속 증가하지 않는다.

### R6 — 최종 아트 교체

- model, board, animation과 effect asset 교체
- presentation manifest version 고정
- screenshot 및 performance regression 검사

완료 기준: 전투 engine, DB와 API를 바꾸지 않고 art asset만 교체하여 배포할 수 있다.

## 19. 최종 불변 조건

1. 전투 engine이 무엇이 발생하는지 결정한다.
2. renderer는 발생한 일을 어떻게 보일지만 결정한다.
3. 서버 snapshot과 event만으로 임의 시점의 전투 화면을 복원할 수 있다.
4. animation, model 또는 effect 실패가 game 진행을 막지 않는다.
5. 3D 좌표는 서버 판정과 DB 저장의 기준이 아니다.
6. renderer 성능 저하가 승패와 event 처리 순서를 바꾸지 않는다.
7. 최종 art 교체는 game engine과 online protocol 변경을 요구하지 않는다.
