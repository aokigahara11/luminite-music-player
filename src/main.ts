import { invoke } from '@tauri-apps/api/core';

// Интерфейс для описания метаданных трека
interface Track {
  id: string;
  path: string;
  title: string;
  artist?: string;
  duration: number;
}

// Интерфейс для описания плейлиста
interface Playlist {
  id: string;
  title: string;
  trackCount: number;
}

// Массив для хранения всех плейлистов
let playlists: Playlist[] = [];

// Функция для визуального обновления прогресс-бара и слайдера громкости
function updateSlider(slider: HTMLInputElement): void {
  const min = Number(slider.min) || 0;
  const max = Number(slider.max) || 100;
  const val = Number(slider.value);
  const percent = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--progress', `${percent}%`);
}

// Преобразование секунд в формат 0:00
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Переключение активного экрана и подсветка кнопки в сайдбаре
function switchView(targetViewId: string, clickedBtn?: HTMLElement | null): void {
  document.querySelectorAll('.view-section').forEach((section) => {
    section.classList.remove('active');
  });

  document.querySelectorAll('.sidebar-left .btn-ctrl').forEach((btn) => {
    btn.classList.remove('active');
  });

  const targetSection = document.getElementById(targetViewId);
  if (targetSection) {
    targetSection.classList.add('active');
  }

  if (clickedBtn) {
    clickedBtn.classList.add('active');
  }
}

// Вызов команды Tauri для выбора файла и получения его метаданных
async function openAudioPicker(): Promise<Track | null> {
  try {
    const track = await invoke<Track | null>('pick_files');
    if (track) {
      console.log('Добавлен трек:', track);
      return track;
    }
    return null;
  } catch (err) {
    console.error('Ошибка при вызове pick_files:', err);
    return null;
  }
}

// Инициализация при полной загрузке DOM
document.addEventListener('DOMContentLoaded', () => {
  // Получение элементов модального окна плейлистов
  const modal = document.getElementById('create-playlist-modal');
  const playlistInput = document.getElementById('playlist-name-input') as HTMLInputElement | null;
  const btnCreateMain = document.getElementById('create-playlist-btn');
  const btnCreateEmpty = document.getElementById('empty-create-playlist-btn');
  const btnCloseModal = document.getElementById('close-modal-btn');
  const btnSubmitModal = document.getElementById('submit-playlist-btn');

  // Получение элементов сетки плейлистов
  const playlistsEmptyState = document.getElementById('playlists-empty-state');
  const playlistsGrid = document.querySelector('#view-playlists .cards-grid') as HTMLElement | null;

  // Получение элементов плеера и управления
  const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement | null;
  const progressSlider = document.getElementById('progress-slider') as HTMLInputElement | null;
  const progressTooltip = document.getElementById('progress-tooltip') as HTMLDivElement | null;
  const btnEmptyScan = document.getElementById('empty-scan-btn');
  const btnAddTrack = document.getElementById('add-track-btn');
  const addBtn = document.getElementById('add-btn') as HTMLButtonElement | null;

  // Кнопки навигации сайдбара
  const mainBtn = document.getElementById('main-btn');
  const mediaBtn = document.getElementById('media-libary-btn');
  const playlistsBtn = document.getElementById('playlists-btn');

  // Временная заглушка длительности текущего трека
  const TOTAL_DURATION = 204;

  // Открытие модального окна создания плейлиста
  function openModal(): void {
    if (modal && playlistInput) {
      modal.classList.remove('hidden');
      playlistInput.value = '';
      playlistInput.focus();
    }
  }

  // Закрытие модального окна
  function closeModal(): void {
    if (modal) {
      modal.classList.add('hidden');
    }
  }

  // Добавление нового плейлиста в список
  function createPlaylist(): void {
    if (!playlistInput) return;
    const title = playlistInput.value.trim();
    if (title) {
      playlists.push({
        id: Date.now().toString(),
        title,
        trackCount: 0,
      });

      closeModal();
      renderPlaylists();
    }
  }

  // Отрисовка карточек плейлистов или пустого состояния
  function renderPlaylists(): void {
    if (!playlistsEmptyState || !playlistsGrid) return;

    if (playlists.length === 0) {
      playlistsEmptyState.classList.remove('hidden');
      playlistsGrid.classList.add('hidden');
      playlistsGrid.innerHTML = '';
    } else {
      playlistsEmptyState.classList.add('hidden');
      playlistsGrid.classList.remove('hidden');

      playlistsGrid.innerHTML = playlists
        .map(
          (pl) => `
          <div class="media-card" data-id="${pl.id}">
            <div class="card-cover-wrapper">
              <div class="card-cover" style="background: #282828; display:flex; align-items:center; justify-content:center; height: 100%;">
                <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 32px; height: 32px;">
                  <line x1="8" y1="6" x2="21" y2="6"></line>
                  <line x1="8" y1="12" x2="21" y2="12"></line>
                  <line x1="8" y1="18" x2="21" y2="18"></line>
                </svg>
              </div>
              <button class="card-play-btn">
                <svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="6,4 20,12 6,20" />
                </svg>
              </button>
            </div>
            <div class="card-title">${pl.title}</div>
            <div class="card-artist">${pl.trackCount} треков</div>
          </div>
        `
        )
        .join('');
    }
  }

  // Настройка слайдера громкости
  if (volumeSlider) {
    updateSlider(volumeSlider);
    volumeSlider.addEventListener('input', () => updateSlider(volumeSlider));
  }

  // Настройка прогресс-бара и всплывающего таймера
  if (progressSlider) {
    const handleProgressInput = () => {
      updateSlider(progressSlider);

      if (progressTooltip) {
        const val = Number(progressSlider.value);
        const max = Number(progressSlider.max) || 100;
        const percent = (val / max) * 100;

        progressTooltip.style.left = `${percent}%`;
        progressTooltip.textContent = formatTime((val / max) * TOTAL_DURATION);
      }
    };

    handleProgressInput();
    progressSlider.addEventListener('input', handleProgressInput);
  }

  // Привязка вызова файлового диалога к кнопкам
  btnEmptyScan?.addEventListener('click', async () => {
    await openAudioPicker();
  });

  btnAddTrack?.addEventListener('click', async () => {
    await openAudioPicker();
  });

  // Анимация и логика кнопки добавления в медиатеку
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const isAdded = addBtn.classList.toggle('added');
      addBtn.title = isAdded ? 'Удалить из медиатеки' : 'Добавить';

      const currentIcon = addBtn.querySelector(isAdded ? '.icon-check' : '.icon-plus');

      if (currentIcon) {
        currentIcon.classList.add('icon-animating');
        currentIcon.addEventListener(
          'animationend',
          () => {
            currentIcon.classList.remove('icon-animating');
          },
          { once: true }
        );
      }
    });
  }

  // Настройка кликов по навигации в левой панели
  mainBtn?.addEventListener('click', (e) => switchView('view-main', e.currentTarget as HTMLElement));
  mediaBtn?.addEventListener('click', (e) => switchView('view-media-library', e.currentTarget as HTMLElement));
  playlistsBtn?.addEventListener('click', (e) => switchView('view-playlists', e.currentTarget as HTMLElement));

  // Установка стартового экрана (Главная)
  switchView('view-main', mainBtn);

  // Настройка вызовов модального окна плейлистов
  btnCreateMain?.addEventListener('click', openModal);
  btnCreateEmpty?.addEventListener('click', openModal);
  btnCloseModal?.addEventListener('click', closeModal);

  // Закрытие модалки при клике на затемнённый фон
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Подтверждение создания плейлиста кнопкой или нажатием Enter
  btnSubmitModal?.addEventListener('click', createPlaylist);

  playlistInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createPlaylist();
  });

  // Первичный рендер плейлистов при старте
  renderPlaylists();
});