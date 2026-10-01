import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences, tokenize } from '../js/segmenter.js';

test('基本分句：句點、問號、驚嘆號', () => {
  assert.deepEqual(
    splitSentences('Ich heiße Anna. Wie heißt du? Das ist toll!'),
    ['Ich heiße Anna.', 'Wie heißt du?', 'Das ist toll!'],
  );
});

test('縮寫不會被切開', () => {
  assert.deepEqual(
    splitSentences('Dr. Müller kommt heute. Ich esse gern Obst, z.B. Äpfel. Das ist gut, d. h. sehr gut.'),
    ['Dr. Müller kommt heute.', 'Ich esse gern Obst, z.B. Äpfel.', 'Das ist gut, d. h. sehr gut.'],
  );
  assert.deepEqual(
    splitSentences('Wir kaufen Brot, Milch usw. und gehen nach Hause.'),
    ['Wir kaufen Brot, Milch usw. und gehen nach Hause.'],
  );
});

test('序數加月份、序數加小寫、冠詞加序數', () => {
  assert.deepEqual(
    splitSentences('Am 3. Oktober ist Feiertag. Er ist der 2. Sohn.'),
    ['Am 3. Oktober ist Feiertag.', 'Er ist der 2. Sohn.'],
  );
  assert.deepEqual(splitSentences('Das war im 19. jahrhundert so.'), ['Das war im 19. jahrhundert so.']);
});

test('句尾的數字仍然會分句', () => {
  assert.deepEqual(splitSentences('Ich bin 25. Ich wohne in Wien.'), ['Ich bin 25.', 'Ich wohne in Wien.']);
});

test('引號內的句子', () => {
  assert.deepEqual(
    splitSentences('Er sagt: „Ich komme morgen.“ Dann geht er.'),
    ['Er sagt: „Ich komme morgen.“', 'Dann geht er.'],
  );
});

test('換行與空行視為邊界，空白會被整理', () => {
  assert.deepEqual(
    splitSentences('Mein Wochenende\n\nAm Samstag   schlafe ich lange.\r\nAm Sonntag koche ich.\n\n\n'),
    ['Mein Wochenende', 'Am Samstag schlafe ich lange.', 'Am Sonntag koche ich.'],
  );
});

test('空輸入與只有標點', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences('   \n ... \n'), []);
});

test('tokenize：單字、變音、ß、連字號，接回去等於原句', () => {
  const s = 'Die U-Bahn fährt um 8 Uhr, oder? Geht\'s gut, Straße!';
  const tokens = tokenize(s);
  assert.equal(tokens.map((t) => t.text).join(''), s);
  assert.deepEqual(
    tokens.filter((t) => t.word).map((t) => t.text),
    ['Die', 'U-Bahn', 'fährt', 'um', 'Uhr', 'oder', 'Geht\'s', 'gut', 'Straße'],
  );
});
