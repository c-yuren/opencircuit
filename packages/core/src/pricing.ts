import type { Definition, Price } from './model';

type Reference = {
  amount: number;
  packSize: number;
  supplier: string;
  product: string;
  url: string;
};
const reference = (
  amount: number,
  packSize: number,
  product: string,
  url: string,
  supplier = 'iCShop',
): Reference => ({ amount, packSize, supplier, product, url });
// Public page prices checked 2026-10-23, in integer TWD minor units per retail pack.
// Each row selects one stated specification. These are reference listings, not live quotes.
const references: Record<string, Reference> = {
  'esp32-devkitc-v4': reference(
    36567,
    1,
    'ESP32-DevKitC-32E 單片價，稅運另計',
    'https://www.mouser.tw/en/ProductDetail/Espressif-Systems/ESP32-DevKitC-32E?qs=GedFDFLaBXFpgD0kAZWDrQ%3D%3D',
    'Mouser',
  ),
  'arduino-uno-r3': reference(
    27900,
    1,
    'Uno R3 ATmega16U2 相容板，非義大利原廠；頁面標示售完',
    'https://www.icshop.com.tw/products/368030501763',
  ),
  'led-red': reference(
    1000,
    5,
    'BL-B6334 5mm 紅光 LED，5顆；頁面標示售完',
    'https://www.icshop.com.tw/products/3680114000133',
  ),
  resistor: reference(
    500,
    10,
    '220Ω 1/8W 1% 插板電阻，10顆',
    'https://www.icshop.com.tw/products/368010201494',
  ),
  'ssd1306-oled': reference(
    9700,
    1,
    'SSD1306 0.96吋 128×64 白字 I2C 3.3V；頁面標示售完',
    'https://www.icshop.com.tw/products/368030101197',
  ),
  'ssd1306-oled-5v': reference(
    14000,
    1,
    'SSD1306 0.96吋 128×64 藍字 I2C 2.8–5V，頁面特價',
    'https://www.icshop.com.tw/categories/oled',
  ),
  dht22: reference(
    22000,
    1,
    'CIRCUS Pi DHT22 模組；頁面標示售完',
    'https://www.icshop.com.tw/products/368112100025',
  ),
  button: reference(
    200,
    1,
    '6×6mm 直插輕觸開關',
    'https://www.icshop.com.tw/categories/tactile-and-push-buttons',
  ),
  mpu6050: reference(
    9500,
    1,
    'MPU-6050 六軸模組，附排針；頁面標示售完',
    'https://www.icshop.com.tw/products/368030200139',
  ),
  buzzer: reference(
    9500,
    1,
    'PT-723B-76Q 外部驅動壓電蜂鳴器',
    'https://www.icshop.com.tw/ms/categories/buzzers',
  ),
  breadboard: reference(
    3900,
    1,
    '400孔透明麵包板 83×55mm',
    'https://www.icshop.com.tw/products/3680902000260',
  ),
  jumper: reference(
    2500,
    40,
    '20cm 公對公杜邦線，40條；頁面標示售完',
    'https://www.ucielectronics.com/categories/杜邦線-10cm20cm30cm13',
    'UCI電子',
  ),
  'usb-supply': reference(
    9900,
    1,
    'HJ-C10101 USB 5V/1A 充電器；頁面標示售完',
    'https://www.hungfu-pc.com.tw/products/5w小方頭充電器',
    '宏晉',
  ),
  capacitor: reference(
    500,
    10,
    '100nF 104 50V 陶瓷電容，10顆',
    'https://www.yu-cang.com.tw/products/52f04127-c75e-42b5-9f41-234e3cd12d10',
    '宇倉電子',
  ),
  header: reference(
    1400,
    2,
    '2.54mm 40P 直排針，2排',
    'https://www.ltc.com.tw/products/con121402q2',
    '聯騰電子',
  ),
};
references['dht22-5v'] = references.dht22;
references['mpu6050-5v'] = references.mpu6050;
const usbCableReference = reference(
  4500,
  1,
  'USB 2.0 A公–B公 1.5m；頁面標示售完',
  'https://www.icshop.com.tw/products/368110900209',
);

export function catalogPrice(d: Definition): Price | null {
  if (d.price) return d.price;
  if (!d.physical || d.version !== '1.0.0') return null;
  const usbCable =
    d.model === 'USB-A to USB-B data cable for Uno R3' &&
    d.category === 'connector' &&
    d.moduleVersion === '1' &&
    d.unit === 'cable' &&
    d.pins.length === 0 &&
    Object.keys(d.parameters).length === 0;
  if (d.typeId === 'official:resistor' && Number(d.parameters.resistance) !== 220) return null;
  if (d.typeId === 'official:capacitor' && d.parameters.capacitance !== '100nF') return null;
  if (d.typeId === 'official:usb-supply' && Number(d.parameters.voltage ?? 5) !== 5) return null;
  const quote = d.typeId.startsWith('official:')
    ? references[d.typeId.slice('official:'.length)]
    : usbCable
      ? usbCableReference
      : undefined;
  if (!quote) return null;
  return {
    low: quote.amount,
    high: quote.amount,
    packSize: quote.packSize,
    basis: quote.packSize === 1 ? 'piece' : 'pack',
    currency: 'TWD',
    date: '2026-10-23',
    source: quote.supplier + '｜' + quote.product + ' ' + quote.url,
    demo: false,
  };
}
