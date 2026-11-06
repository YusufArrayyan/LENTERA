// LENTERA modul pemantau (ESP32 + INA219 + SHT31 + DS3231)
// Membaca tegangan/arus baterai, suhu, kelembapan, dan sumber daya tiap 5 menit,
// lalu mengirim JSON ke server sekolah lewat HTTP (F-2.1, F-2.2).
// Lampu indikator RGB mengikuti balasan server: hijau / kuning / merah (F-2.4).
// Modul ini terpisah dari server: bila modul mati, pembelajaran tetap jalan (F-2.7).
//
// Pustaka Arduino: Adafruit INA219, Adafruit SHT31, RTClib, ArduinoJson (v7).
// Semua ambang ada di server; firmware hanya mengirim angka mentah.

#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <Adafruit_SHT31.h>
#include <RTClib.h>
#include <ArduinoJson.h>
#include <esp_random.h>

// ---- Konfigurasi per kotak (isi saat perakitan) ----
const char* WIFI_SSID   = "LENTERA-001";
const char* WIFI_PASS   = "ganti-kata-sandi-wifi";
const char* SERVER_URL  = "http://10.42.0.1:8080/ingest/telemetry";
const char* IOT_KEY     = "isi-dari-data/AKUN-DEMO.txt";
const char* MODULE_ID   = "LTR-0001-IOT";

const uint32_t INTERVAL_MS = 5UL * 60UL * 1000UL;
const int PIN_LED_R = 25, PIN_LED_G = 26, PIN_LED_B = 27;
const int PIN_PLTS_SENSE = 34;   // pembagi tegangan dari jalur panel surya
const int PIN_ADAPTOR_SENSE = 35; // pembagi tegangan dari adaptor PLN
const int QUEUE_MAX = 24;          // simpan maksimal 2 jam pembacaan saat server tidak terjangkau

Adafruit_INA219 ina219;
Adafruit_SHT31 sht31;
RTC_DS3231 rtc;

String queue[QUEUE_MAX];
int qHead = 0, qLen = 0;

void led(bool r, bool g, bool b) {
  digitalWrite(PIN_LED_R, r);
  digitalWrite(PIN_LED_G, g);
  digitalWrite(PIN_LED_B, b);
}

String uuid4() {
  uint8_t b[16];
  for (int i = 0; i < 16; i += 4) { uint32_t r = esp_random(); memcpy(b + i, &r, 4); }
  b[6] = (b[6] & 0x0F) | 0x40;
  b[8] = (b[8] & 0x3F) | 0x80;
  char s[37];
  snprintf(s, sizeof(s), "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
  return String(s);
}

String isoNow() {
  DateTime n = rtc.now();  // RTC diset ke UTC saat perakitan
  char s[25];
  snprintf(s, sizeof(s), "%04d-%02d-%02dT%02d:%02d:%02dZ", n.year(), n.month(), n.day(), n.hour(), n.minute(), n.second());
  return String(s);
}

String powerSource() {
  if (analogRead(PIN_ADAPTOR_SENSE) > 1500) return "adaptor";
  if (analogRead(PIN_PLTS_SENSE) > 1500) return "plts";
  return "baterai";
}

String buildReading() {
  JsonDocument doc;
  doc["event_id"] = uuid4();  // ID unik: server mengabaikan kiriman ulang yang sama
  doc["module_id"] = MODULE_ID;
  doc["voltage"] = ina219.getBusVoltage_V() + ina219.getShuntVoltage_mV() / 1000.0;
  doc["current"] = ina219.getCurrent_mA() / 1000.0;
  float t = sht31.readTemperature(), h = sht31.readHumidity();
  if (!isnan(t)) doc["temp"] = t;
  if (!isnan(h)) doc["humidity"] = h;
  doc["power_source"] = powerSource();
  doc["measured_at"] = isoNow();
  String out;
  serializeJson(doc, out);
  return out;
}

void enqueue(const String& s) {
  int idx = (qHead + qLen) % QUEUE_MAX;
  queue[idx] = s;
  if (qLen < QUEUE_MAX) qLen++; else qHead = (qHead + 1) % QUEUE_MAX;  // buang yang tertua
}

bool post(const String& body, String& lampu) {
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.setTimeout(8000);
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Lentera-Key", IOT_KEY);
  int code = http.POST(body);
  if (code == 200) {
    JsonDocument res;
    if (!deserializeJson(res, http.getString())) lampu = res["lampu"] | "hijau";
  }
  http.end();
  return code == 200;
}

void flush() {
  while (qLen > 0) {
    String lampu = "";
    if (!post(queue[qHead], lampu)) { led(false, false, true); return; }  // biru: server tidak terjangkau
    qHead = (qHead + 1) % QUEUE_MAX;
    qLen--;
    if (lampu == "merah") led(true, false, false);
    else if (lampu == "kuning") led(true, true, false);
    else led(false, true, false);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED_R, OUTPUT); pinMode(PIN_LED_G, OUTPUT); pinMode(PIN_LED_B, OUTPUT);
  led(true, true, true);
  Wire.begin();
  if (!ina219.begin()) Serial.println("INA219 tidak terdeteksi");
  if (!sht31.begin(0x44)) Serial.println("SHT31 tidak terdeteksi");
  if (!rtc.begin()) Serial.println("RTC tidak terdeteksi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

uint32_t last = 0;
void loop() {
  if (last == 0 || millis() - last >= INTERVAL_MS) {
    last = millis();
    if (WiFi.status() != WL_CONNECTED) WiFi.reconnect();
    enqueue(buildReading());
    flush();
  }
  delay(200);
}
