import type { Definition } from '../../../packages/core/src/model';
import { boardLeft, boardRight, componentVisual } from '../../../packages/core/src/graphics';
import { oledImage } from './oled';
import { t } from './i18n';

export function HardwareArt({
  definition,
  className = '',
  parameters = {},
  ledOn,
  screen,
  buzzing,
  pressed,
}: {
  definition: Definition;
  className?: string;
  parameters?: Record<string, unknown>;
  ledOn?: boolean;
  // True while a simulated buzzer is producing sound; undefined when not simulating.
  buzzing?: boolean;
  // True while a simulated push button is held down on the canvas.
  pressed?: boolean;
  // Simulated OLED frame; '' while the panel is off, undefined when not simulating.
  screen?: string;
}) {
  const v = componentVisual(definition);
  const color = String(parameters.color ?? definition.parameters.color ?? 'red');
  const ledColor =
    (
      {
        red: '#e45767',
        green: '#43b879',
        blue: '#408ed8',
        yellow: '#e3c544',
        white: '#eff4f6',
      } as Record<string, string>
    )[color] ?? (/^#[\da-f]{6}$/i.test(color) ? color : '#e45767');
  const contact = (x: number, y: number, key: string | number) => (
    <g key={key}>
      <rect
        x={x - 5}
        y={y - 5}
        width="10"
        height="10"
        rx="1.4"
        fill="#d9b653"
        stroke="#725c23"
        strokeWidth=".7"
      />
      <circle cx={x} cy={y} r="2.9" fill="#131d1c" />
    </g>
  );
  const screw = (x: number, y: number) => (
    <g key={x + ',' + y}>
      <circle cx={x} cy={y} r="5" fill="#d9b653" />
      <circle cx={x} cy={y} r="2.7" fill="#273235" />
    </g>
  );
  const passive = (x: number, y: number) => (
    <g key={x + ',' + y}>
      <rect x={x} y={y} width="10" height="5" rx="1" fill="#c7bc96" />
      <path d={`M${x} ${y}v5m10-5v5`} stroke="#aeb9ba" strokeWidth="2" />
    </g>
  );
  let body;
  if (v.image)
    body = <image href={v.image} width={v.width} height={v.height} preserveAspectRatio="none" />;
  else if (v.preset === 'uno')
    body = (
      <g>
        <path
          d="M18 4H297L316 23V188L296 216H18V175H4V127H18V89H4V31H18Z"
          fill="#1d809c"
          stroke="#154e64"
          strokeWidth="3"
        />
        <rect x="0" y="31" width="49" height="57" rx="3" fill="#b9c6ce" />
        <rect x="3" y="37" width="20" height="44" fill="#263333" />
        <rect x="0" y="137" width="50" height="34" rx="4" fill="#23343a" />
        <ellipse cx="12" cy="154" rx="11" ry="15" fill="#0b1519" />
        <rect x="98" y="111" width="157" height="42" rx="4" fill="#182326" stroke="#607276" />
        <text x="150" y="137" fill="#98a5a4" fontSize="9">
          ATMEGA328P
        </text>
        {Array.from({ length: 14 }, (_, n) => (
          <g key={n}>
            <rect x={102 + n * 10} y="105" width="5" height="7" fill="#b9c6ce" />
            <rect x={102 + n * 10} y="152" width="5" height="7" fill="#b9c6ce" />
          </g>
        ))}
        <text x="104" y="85" fill="#f1f7ed" fontSize="27" fontWeight="700">
          ARDUINO UNO
        </text>
        <text x="188" y="99" fill="#d7eee8" fontSize="10">
          R3 · 16 MHz
        </text>
        <rect x="73" y="36" width="24" height="23" fill="#303c42" />
        <rect x="42" y="98" width="14" height="21" fill="#adc2c5" />
        {[60, 80].map((x) => (
          <circle key={x} cx={x} cy="174" r="9" fill="#b9c6ce" />
        ))}
        {definition.pins.map((pin) => {
          const pos = v.pinPositions[pin.id];
          return (
            <g key={pin.id}>
              <rect
                x={pos.x * 320 - 6}
                y={pos.y * 220 - 7}
                width="12"
                height="14"
                rx="1"
                fill="#202e34"
              />
              <circle cx={pos.x * 320} cy={pos.y * 220} r="3" fill="#d9b653" />
              <text
                x={pos.x * 320}
                y={pos.y < 0.5 ? 35 : 188}
                fontSize="5.5"
                textAnchor="middle"
                fill="#ecf2e8"
              >
                {pin.id}
              </text>
            </g>
          );
        })}
        <circle cx="288" cy="173" r="4" fill="#68ad64" />
        <text x="275" y="164" fontSize="7" fill="#eff5e5">
          ON
        </text>
      </g>
    );
  else if (v.preset === 'esp32')
    body = (
      <>
        <rect
          x="28"
          y="22"
          width="164"
          height="350"
          rx="6"
          fill="#328476"
          stroke="#0b1519"
          strokeWidth="2"
        />
        <rect x="51" y="34" width="118" height="208" rx="3" fill="#183c32" stroke="#778574" />
        <path
          d="M73 40v10h12V39h12v11h12V39h12v11h12V39h14v18"
          fill="none"
          stroke="#acaa6f"
          strokeWidth="2.4"
        />
        <rect
          x="56"
          y="62"
          width="108"
          height="152"
          rx="4"
          fill="#b9c6ce"
          stroke="#7c8c8f"
          strokeWidth="1.3"
        />
        <text
          x="110"
          y="111"
          textAnchor="middle"
          fill="#5d6769"
          fontSize="11"
          fontFamily="monospace"
          fontWeight="700"
        >
          ESPRESSIF
        </text>
        <text
          x="110"
          y="128"
          textAnchor="middle"
          fill="#697276"
          fontSize="8"
          fontFamily="monospace"
        >
          ESP32-WROOM-32E
        </text>
        <text
          x="110"
          y="175"
          textAnchor="middle"
          fill="#6f7c7a"
          fontSize="18"
          fontFamily="sans-serif"
        >
          CE
        </text>
        {Array.from({ length: 12 }, (_, i) => (
          <g key={i}>
            <rect x="47" y={73 + i * 13} width="7" height="7" fill="#b9c6ce" />
            <rect x="166" y={73 + i * 13} width="7" height="7" fill="#b9c6ce" />
          </g>
        ))}
        <rect x="90" y="257" width="39" height="36" rx="2" fill="#171e20" stroke="#50615e" />
        {Array.from({ length: 6 }, (_, i) => (
          <g key={i}>
            <rect x={91 + i * 6} y="253" width="3" height="5" fill="#b9c6ce" />
            <rect x={91 + i * 6} y="293" width="3" height="5" fill="#b9c6ce" />
          </g>
        ))}
        {[
          [57, 254],
          [146, 249],
          [143, 264],
          [61, 287],
          [60, 300],
          [145, 301],
          [142, 319],
        ].map(([x, y]) => passive(x, y))}
        <circle cx="67" cy="233" r="3" fill="#a3362d" stroke="#d87769" />
        <rect x="49" y="315" width="24" height="17" rx="2" fill="#dddcd3" stroke="#8c9390" />
        <circle cx="61" cy="323" r="5" fill="#323739" />
        <rect x="147" y="315" width="24" height="17" rx="2" fill="#dddcd3" stroke="#8c9390" />
        <circle cx="159" cy="323" r="5" fill="#323739" />
        <text x="61" y="343" textAnchor="middle" fill="#b3c7bf" fontSize="6">
          EN
        </text>
        <text x="159" y="343" textAnchor="middle" fill="#b3c7bf" fontSize="6">
          BOOT
        </text>
        <rect x="87" y="339" width="46" height="39" rx="4" fill="#b9c6ce" stroke="#8d979b" />
        <rect x="92" y="365" width="36" height="10" rx="2" fill="#202b2d" />
        <rect x="99" y="365" width="22" height="3" fill="#968975" />
        {boardLeft.map((name, row) => (
          <g key={'l' + row}>
            {contact(18, 64 + row * 15, row)}
            <text
              x="36"
              y={67 + row * 15}
              fill={definition.pins.some((p) => p.id === name) ? '#c8d7cd' : '#617976'}
              fontSize="6.2"
              fontFamily="monospace"
            >
              {name.replace('GPIO', '')}
            </text>
          </g>
        ))}
        {boardRight.map((name, row) => (
          <g key={'r' + row}>
            {contact(202, 64 + row * 15, row)}
            <text
              x="184"
              y={67 + row * 15}
              textAnchor="end"
              fill={
                name !== 'GND' && definition.pins.some((p) => p.id === name) ? '#c8d7cd' : '#617976'
              }
              fontSize="6.2"
              fontFamily="monospace"
            >
              {name.replace('GPIO', '')}
            </text>
          </g>
        ))}
      </>
    );
  else if (v.preset === 'led')
    body = (
      <>
        {ledOn && (
          <ellipse
            className="led-glow"
            cx="44"
            cy="45"
            rx="32"
            ry="38"
            fill={ledColor}
            opacity=".38"
            style={{ filter: `drop-shadow(0 0 9px ${ledColor})` }}
          />
        )}
        <path d="M31 67v50m27-50v42" stroke="#838d92" strokeWidth="5" />
        <g style={{ filter: ledOn === false ? 'brightness(.4)' : undefined }}>
          <path d="M23 63V38a21 21 0 0 1 42 0v25" fill={ledColor} stroke="#555" strokeWidth="1.2" />
          <ellipse cx="44" cy="64" rx="25" ry="8" fill={ledColor} stroke="#555" />
          {ledOn && <ellipse cx="39" cy="37" rx="9" ry="13" fill="white" opacity=".75" />}
        </g>
        <path d="M32 48v13h22V44" fill="none" stroke="#98252d" strokeWidth="2" />
      </>
    );
  else if (v.preset === 'resistor')
    body = (
      <>
        <path d="M12 36h160" stroke="#909796" strokeWidth="4" />
        <path
          d="M51 21c9-5 14-3 18 0h46c4-3 9-5 18 0v30c-9 5-14 3-18 0H69c-4 3-9 5-18 0z"
          fill="#e5d298"
          stroke="#a89b73"
        />
        <path d="M69 21v30" stroke="#b6292b" strokeWidth="7" />
        <path d="M82 21v30" stroke="#b6292b" strokeWidth="7" />
        <path d="M100 21v30" stroke="#865032" strokeWidth="7" />
        <path d="M123 21v30" stroke="#b6a66c" strokeWidth="5" />
      </>
    );
  else if (v.preset === 'oled')
    body = (
      <>
        <rect x="22" y="24" width="146" height="134" rx="4" fill="#3c82c0" stroke="#244979" />
        {[
          [31, 33],
          [159, 33],
          [31, 149],
          [159, 149],
        ].map(([x, y]) => screw(x, y))}
        <rect x="35" y="46" width="120" height="92" rx="3" fill="#15202a" stroke="#5d7787" />
        <rect
          x="39"
          y="50"
          width="112"
          height="79"
          fill={screen === undefined ? '#203d4a' : '#0b141c'}
        />
        {screen ? (
          <image
            href={oledImage(screen)}
            x="39"
            y="61.5"
            width="112"
            height="56"
            preserveAspectRatio="none"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : screen === undefined ? (
          <text
            x="95"
            y="90"
            textAnchor="middle"
            fill="#284252"
            fontSize="8"
            fontFamily="monospace"
          >
            128 × 64
          </text>
        ) : null}
        <rect x="76" y="138" width="39" height="8" fill="#d9b653" />
        {['GND', 'VCC', 'SCL', 'SDA'].map((name, index) => (
          <g key={name}>
            <rect x={42 + index * 32} y="8" width="10" height="18" rx="1" fill="#d9b653" />
            <text
              x={47 + index * 32}
              y="39"
              textAnchor="middle"
              fill="#cbdce3"
              fontSize="6.5"
              fontFamily="monospace"
            >
              {name}
            </text>
          </g>
        ))}
      </>
    );
  else if (v.preset === 'dht')
    body = (
      <>
        <rect x="17" y="29" width="80" height="116" rx="3" fill="#328476" stroke="#1d4740" />
        <rect x="27" y="18" width="60" height="95" rx="5" fill="#eff3f5" stroke="#c1c7bb" />
        {Array.from({ length: 8 }, (_, i) => (
          <g key={i}>
            <rect x="36" y={28 + i * 9} width="17" height="4" rx="1" fill="#a4aca1" />
            <rect x="60" y={28 + i * 9} width="17" height="4" rx="1" fill="#a4aca1" />
          </g>
        ))}
        <text x="57" y="124" textAnchor="middle" fill="#cbdccd" fontSize="7" fontFamily="monospace">
          DHT22
        </text>
        {[27, 57, 87].map((x) => contact(x, 153, x))}
        {passive(37, 133)}
      </>
    );
  else if (v.preset === 'button')
    body = (
      <>
        <path d="M9 31h14m-14 26h14m42-26h14m-14 26h14" stroke="#a4adad" strokeWidth="5" />
        <rect x="22" y="23" width="44" height="43" rx="3" fill="#b9c6ce" stroke="#8b9494" />
        <circle
          cx="44"
          cy="44"
          r={pressed ? 12 : 14}
          fill={pressed ? '#0b0e0f' : '#202528'}
          stroke="#4c5555"
          strokeWidth="2"
        />
        {[
          [27, 28],
          [61, 28],
          [27, 61],
          [61, 61],
        ].map(([x, y]) => (
          <circle key={x + ',' + y} cx={x} cy={y} r="2" fill="#707877" />
        ))}
      </>
    );
  else if (v.preset === 'mpu')
    body = (
      <>
        <rect x="14" y="20" width="112" height="100" rx="4" fill="#3c82c0" stroke="#244979" />
        {[
          [24, 30],
          [116, 30],
        ].map(([x, y]) => screw(x, y))}
        <rect x="46" y="46" width="44" height="39" fill="#1e272b" stroke="#496772" />
        <circle cx="52" cy="52" r="2" fill="#4a565b" />
        <text x="69" y="70" textAnchor="middle" fill="#8c9a9e" fontSize="7" fontFamily="monospace">
          MPU6050
        </text>
        {[
          [31, 48],
          [95, 51],
          [32, 76],
          [96, 80],
        ].map(([x, y]) => passive(x, y))}
        {['VCC', 'GND', 'SCL', 'SDA'].map((name, i) => (
          <g key={name}>
            {contact(25 + i * 30, 125, name)}
            <text x={25 + i * 30} y="111" textAnchor="middle" fill="#cbdce3" fontSize="6">
              {name}
            </text>
          </g>
        ))}
      </>
    );
  else if (v.preset === 'buzzer')
    body = (
      <>
        <path d="M34 74v30m40-30v30" stroke="#8d9999" strokeWidth="4" />
        <ellipse cx="54" cy="70" rx="38" ry="17" fill="#37464f" />
        <rect x="16" y="39" width="76" height="33" fill="#37464f" />
        <ellipse cx="54" cy="39" rx="38" ry="29" fill="#37464f" stroke="#4b5a5e" />
        <ellipse cx="54" cy="39" rx="13" ry="10" fill="#141b1e" stroke="#505e64" />
        <text x="79" y="34" fill="#ccd7d6" fontSize="13">
          +
        </text>
        {buzzing && (
          <g className="buzzer-waves" fill="none" stroke="#f0c75e" strokeLinecap="round">
            <path d="M92 24q5 8 0 16" strokeWidth="2.5" />
            <path d="M97 19q8 12 0 24" strokeWidth="2.5" opacity=".7" />
            <path d="M102 14q10 16 0 32" strokeWidth="2.5" opacity=".45" />
          </g>
        )}
      </>
    );
  else if (v.preset === 'breadboard')
    body = (
      <>
        <rect x="9" y="19" width="298" height="151" rx="8" fill="#eff3f5" stroke="#c9d1c9" />
        <path d="M23 35h269M23 153h269" stroke="#cf7771" strokeWidth="1.5" />
        <path d="M23 42h269M23 146h269" stroke="#7293be" strokeWidth="1.5" />
        <rect x="20" y="91" width="276" height="9" rx="2" fill="#c6cec3" />
        {Array.from({ length: 30 }, (_, col) =>
          Array.from({ length: 10 }, (_, row) => (
            <rect
              key={col + ',' + row}
              x={25 + col * 9}
              y={(row < 5 ? 54 : 103) + (row % 5) * 7}
              width="3"
              height="3"
              rx=".6"
              fill="#8c978f"
            />
          )),
        )}
        {Array.from({ length: 30 }, (_, col) =>
          [30, 47, 138, 158].map((y) => (
            <circle key={col + ',' + y} cx={26 + col * 9} cy={y} r="1.5" fill="#9da89d" />
          )),
        )}
        <text x="18" y="18" fill="#829283" fontSize="7" fontFamily="monospace">
          400 TIE POINTS · BOM
        </text>
      </>
    );
  else if (v.preset === 'jumper')
    body = (
      <>
        {['#b54c48', '#d3b64d', '#397689'].map((color, i) => (
          <g key={color}>
            <path
              d={`M29 ${22 + i * 17}C60 ${-10 + i * 17} 103 ${100 - i * 7} 147 ${32 + i * 17}`}
              fill="none"
              stroke={color}
              strokeWidth="4"
            />
            <rect x="14" y={15 + i * 17} width="17" height="12" rx="2" fill="#263332" />
            <rect x="145" y={26 + i * 17} width="17" height="12" rx="2" fill="#263332" />
          </g>
        ))}
      </>
    );
  else if (v.preset === 'supply')
    body = (
      <>
        <rect x="15" y="20" width="109" height="92" rx="12" fill="#37464f" stroke="#16262b" />
        <rect x="52" y="48" width="30" height="15" fill="#b9c6ce" />
        <rect x="57" y="52" width="20" height="8" fill="#112327" />
        <text x="67" y="84" textAnchor="middle" fill="#b6c6ca" fontSize="8" fontFamily="monospace">
          {String(parameters.voltage ?? 5)} V
        </text>
        <path d="M122 45h17m-17 37h17" stroke="#a1aaa7" strokeWidth="4" />
      </>
    );
  else if (v.preset === 'capacitor')
    body = (
      <>
        <path d="M30 57v31m30-31v31" stroke="#959d9f" strokeWidth="3" />
        <circle cx="45" cy="42" r="25" fill="#eda654" stroke="#a86531" />
        <text x="45" y="48" textAnchor="middle" fill="#965827" fontSize="11" fontFamily="monospace">
          104
        </text>
      </>
    );
  else if (v.preset === 'header')
    body = (
      <>
        <rect x="16" y="26" width="142" height="20" rx="2" fill="#25302e" stroke="#152521" />
        {Array.from({ length: 8 }, (_, i) => (
          <g key={i}>
            <rect x={24 + i * 17} y="9" width="5" height="18" fill="#d9b653" />
            <rect x={24 + i * 17} y="45" width="5" height="13" fill="#d9b653" />
            <rect x={21 + i * 17} y="29" width="11" height="13" rx="1" fill="#394440" />
          </g>
        ))}
      </>
    );
  else if (v.preset === 'ground')
    body = (
      <path
        d="M34 8v26m-21 0h42m-35 10h28m-20 10h12"
        fill="none"
        stroke="#597169"
        strokeWidth="3"
        strokeLinecap="round"
      />
    );
  else
    body = (
      <>
        <rect
          x="20"
          y="15"
          width={v.width - 40}
          height={v.height - 30}
          rx="7"
          fill="#328476"
          stroke="#32675b"
        />
        <rect
          x={v.width / 2 - 30}
          y={v.height / 2 - 22}
          width="60"
          height="44"
          rx="2"
          fill="#1b292b"
          stroke="#47615b"
        />
        <text
          x={v.width / 2}
          y={v.height / 2 + 3}
          textAnchor="middle"
          fill="#93b5a7"
          fontSize="9"
          fontFamily="monospace"
        >
          CUSTOM
        </text>
        {Object.entries(v.pinPositions).map(([id, pos]) =>
          contact(pos.x * v.width, pos.y * v.height, id),
        )}
        <path
          d={`M${v.width / 2 - 31} ${v.height / 2}H30M${v.width / 2 + 31} ${v.height / 2}H${v.width - 30}`}
          stroke="#759470"
        />
      </>
    );
  return (
    <svg
      className={'hardware-art ' + className}
      viewBox={`0 0 ${v.width} ${v.height}`}
      width={v.width}
      height={v.height}
      role="img"
      aria-label={t('{name} 元件圖', { name: t(definition.name) })}
      data-led-state={
        v.preset === 'led' && ledOn !== undefined ? (ledOn ? 'on' : 'off') : undefined
      }
      data-buzzer-state={
        v.preset === 'buzzer' && buzzing !== undefined ? (buzzing ? 'on' : 'off') : undefined
      }
    >
      {body}
    </svg>
  );
}
