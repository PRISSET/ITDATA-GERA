export const chapters = [
  {
    id: 'hello',
    label: 'Start',
    eyebrow: 'Bevor wir anfangen …',
    title: 'Seid ihr bereit?',
    body: 'Dann ruft alle zusammen ganz laut: JA!',
    note: '',
  },
  {
    id: 'intro',
    label: 'Gera',
    eyebrow: 'Ein Ort. Viele Verbindungen.',
    title: 'IT aus Gera.',
    body: 'ITDATA-Gera ist ein IT-Service aus Thüringen. Sebastian Serfling hilft kleinen und mittleren Firmen mit ihrer Technik.',
    note: 'Gera · Thüringen',
  },
  {
    id: 'network',
    label: 'Netzwerk',
    eyebrow: 'Menschen und Technik',
    title: 'Alles ist verbunden.',
    body: 'Computer, Server und E-Mails sollen jeden Tag funktionieren. ITDATA-Gera bietet persönliche Hilfe vor Ort.',
    note: 'IT-Service für Firmen',
  },
  {
    id: 'servers',
    label: 'Server',
    eyebrow: 'Stabile Systeme',
    title: 'Server. Mail. VPN.',
    body: 'ITDATA-Gera betreut Linux- und Windows-Server. Dazu gehören E-Mails und sichere Verbindungen über das Internet.',
    note: 'Administration & Support',
  },
  {
    id: 'cloud',
    label: 'Cloud',
    eyebrow: 'Zusammenarbeit',
    title: 'Dateien. Webseiten.',
    body: 'Mit Nextcloud können Menschen Dateien teilen. ITDATA-Gera arbeitet auch mit WordPress und TYPO3 an Webseiten.',
    note: 'Nextcloud · WordPress · TYPO3',
  },
  {
    id: 'training',
    label: 'Berufe',
    eyebrow: 'Berufe in der IT',
    title: 'Dein Weg in die IT.',
    body: 'Systemintegration passt zu Servern und Netzwerken. Anwendungsentwicklung passt zu Software. IT-System-Elektronik passt zu Geräten.',
    note: 'Passende Berufe — keine bestätigten Stellen',
  },
  {
    id: 'end',
    label: 'Fazit',
    eyebrow: 'Unser Fazit',
    title: 'Technik verbindet.',
    body: 'Gute IT hilft Firmen jeden Tag: Sie verbindet Geräte, schützt Daten und macht Zusammenarbeit einfacher.',
    note: 'Gute IT verbindet Menschen, Geräte und Daten.',
  },
  {
    id: 'thanks',
    label: 'Danke',
    eyebrow: 'Es sprachen',
    title: 'Danke für Ihre Aufmerksamkeit!',
    body: '',
    note: '',
  },
] as const

export const cast = [
  { name: 'Irina', part: 'Wer ist ITDATA-Gera?' },
  { name: 'Nazar', part: 'Was macht ITDATA-Gera?' },
  { name: 'Svetlana', part: 'Ausbildung und Fazit' },
] as const

export function chapterWeights(progress: number): number[] {
  const position = Math.max(0, Math.min(1, progress)) * (chapters.length - 1)
  return chapters.map((_, index) => {
    const distance = Math.abs(position - index)
    const value = Math.max(0, 1 - distance)
    return value * value * (3 - 2 * value)
  })
}
