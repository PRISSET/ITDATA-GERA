<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { gsap } from 'gsap'
import NetworkScene from './components/NetworkScene.vue'
import { cast, chapters, chapterWeights } from './story'

type SceneHandle = { setProgress: (value: number) => void }

const scene = ref<SceneHandle | null>(null)
const activeIndex = ref(0)
const ready = ref(false)
const loadProgress = ref(0)
const displayedNumber = ref('01')
const transition = { progress: 0 }
let transitionTween: gsap.core.Tween | null = null
let targetIndex = 0
let wheelTotal = 0
let lastWheelAt = 0
let wheelConsumed = false
let touchStartY = 0

function update(progress: number) {
  scene.value?.setProgress(progress)
  const weights = chapterWeights(progress)
  const index = weights.indexOf(Math.max(...weights))
  if (index !== activeIndex.value) {
    activeIndex.value = index
    displayedNumber.value = String(index + 1).padStart(2, '0')
  }
  document.documentElement.style.setProperty('--scroll-progress', `${progress * 100}%`)
}

function step(direction: number) {
  if (!ready.value || transitionTween || !direction) return
  const next = Math.max(0, Math.min(chapters.length - 1, targetIndex + Math.sign(direction)))
  if (next === targetIndex) return
  targetIndex = next
  transitionTween = gsap.to(transition, {
    progress: next / (chapters.length - 1),
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1.22,
    ease: 'power2.inOut',
    onUpdate: () => update(transition.progress),
    onComplete: () => {
      transitionTween = null
      update(transition.progress)
    },
  })
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  const now = performance.now()
  if (now - lastWheelAt > 280) {
    wheelTotal = 0
    wheelConsumed = false
  }
  lastWheelAt = now
  if (wheelConsumed) return
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
  wheelTotal += event.deltaY * multiplier
  if (Math.abs(wheelTotal) >= 55) {
    wheelConsumed = true
    step(wheelTotal)
  }
}

function onTouchStart(event: TouchEvent) {
  touchStartY = event.changedTouches[0]?.clientY ?? 0
}

function onTouchEnd(event: TouchEvent) {
  const distance = touchStartY - (event.changedTouches[0]?.clientY ?? touchStartY)
  if (Math.abs(distance) > 45) step(distance)
}

function onKeyDown(event: KeyboardEvent) {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
  if (['ArrowDown', 'PageDown', ' ', 'ArrowUp', 'PageUp'].includes(event.key)) {
    event.preventDefault()
    step(['ArrowUp', 'PageUp'].includes(event.key) ? -1 : 1)
  }
}

onMounted(() => {
  update(0)
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
  window.addEventListener('keydown', onKeyDown)
})

onBeforeUnmount(() => {
  transitionTween?.kill()
  window.removeEventListener('wheel', onWheel)
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchend', onTouchEnd)
  window.removeEventListener('keydown', onKeyDown)
  document.documentElement.style.removeProperty('--scroll-progress')
})
</script>

<template>
  <main class="presentation" :class="{ 'is-ready': ready }" aria-label="Präsentation über ITDATA-Gera">
    <NetworkScene ref="scene" @progress="loadProgress = $event" @ready="ready = true" />
    <div class="overlay" aria-hidden="true" />

    <div class="preloader" :class="{ 'is-done': ready }" role="status" :aria-hidden="ready">
      <img class="preloader-logo" src="/itdata-logo.png" alt="ITDATA-Gera" width="811" height="187" />
      <div class="preloader-bar"><i :style="{ transform: `scaleX(${loadProgress})` }" /></div>
      <span class="preloader-count">{{ Math.round(loadProgress * 100) }}%</span>
      <span class="preloader-credit">Made by Nazar</span>
    </div>

    <header class="masthead">
      <div class="brand-lockup">
        <img class="grone-badge" src="/image.png" alt="Grone" width="44" height="44" />
        <span class="brand-divider" aria-hidden="true" />
        <img class="itdata-logo" src="/itdata-logo.png" alt="ITDATA-Gera" width="811" height="187" />
      </div>
      <span class="masthead-label">Ein Schulprojekt über IT-Service in Thüringen</span>
      <span class="masthead-count"><strong :key="displayedNumber">{{ displayedNumber }}</strong><span>/ {{ String(chapters.length).padStart(2, '0') }}</span></span>
    </header>

    <div class="copy-stage">
      <article
        v-for="(chapter, index) in chapters"
        :key="chapter.id"
        class="chapter"
        :class="[`chapter--${chapter.id}`, { 'is-active': index === activeIndex, 'is-past': index < activeIndex }]"
        :aria-hidden="index !== activeIndex"
        :inert="index !== activeIndex"
      >
        <p v-if="chapter.id !== 'thanks'" class="eyebrow">{{ chapter.eyebrow }}</p>
        <component :is="index === 0 ? 'h1' : 'h2'" class="title" :aria-label="chapter.title">
          <span v-for="(word, wi) in chapter.title.split(' ')" :key="wi" class="word" aria-hidden="true"><span
            v-for="(char, ci) in word" :key="ci" class="char" :style="{ '--i': wi * 3 + ci }">{{ char }}</span></span>
        </component>
        <ul v-if="chapter.id === 'thanks'" class="cast" :aria-label="chapter.eyebrow">
          <li v-for="(person, pi) in cast" :key="person.name" :style="{ '--p': pi }">
            <span class="cast-line" />
            <strong>{{ person.name }}</strong>
            <span>{{ person.part }}</span>
          </li>
        </ul>
        <p v-if="chapter.body" class="chapter-body">{{ chapter.body }}</p>
        <p v-if="chapter.id === 'thanks' || chapter.id === 'hello'" class="made-by">
          <img class="grone-badge" src="/image.png" alt="Grone" width="56" height="56" />
          <span>Produziert von Schülern der Grone<br />für <strong>ITDATA-Gera</strong></span>
          <img class="itdata-logo" src="/itdata-logo.png" alt="ITDATA-Gera" width="811" height="187" />
        </p>
        <div v-if="chapter.note" class="chapter-note"><span>Sprecher {{ index < 3 ? 1 : index < 5 ? 2 : 3 }}</span><span class="note-divider" /><span>{{ chapter.note }}</span></div>
      </article>
    </div>

    <nav class="rail" aria-hidden="true">
      <span v-for="(chapter, index) in chapters" :key="chapter.id" :class="{ 'rail-step--active': index === activeIndex, 'rail-step--done': index < activeIndex }">
        {{ chapter.label }}<b>{{ String(index + 1).padStart(2, '0') }}</b>
      </span>
    </nav>
    <footer class="footer">Quellen: itdata-gera.de, BERUFENET</footer>
  </main>
</template>
