// Einstellungen für den Betrieb. In der Android-App gibt es keine eigene Web-Adresse,
// deshalb stehen hier die öffentlichen Adressen.
export const CONFIG = {
  // Hier liegt die Web-Version. Termin-Links aus der App zeigen dorthin.
  publicUrl: 'https://baum97.github.io/terminus/',
  // Server mit KI (proxy/server.mjs), z. B. 'https://terminus.example.de/'.
  // Leer: Im Browser wird derselbe Server genutzt, in der App gibt es dann nur die Erkennung ohne KI
  // oder einen eigenen Schlüssel.
  serverUrl: '',
};
