# Ricette Ciociare e non solo – sito e-commerce

Sito statico (HTML, CSS, JavaScript) con catalogo, carrello e **grembiule in 3D**
che si può ruotare e cambiare colore (rosso, nero, bianco, verde).

## Pagine

| Indirizzo        | Contenuto                                                  |
| ---------------- | ---------------------------------------------------------- |
| `#home`          | Home con logo, foto dei grembiuli ricamati e collegamenti  |
| `#chi-siamo`     | “Arriverà presto”                                          |
| `#catalogo`      | Catalogo (per ora solo il grembiule)                       |
| `#grembiule`     | Configuratore 3D: colore, taglia unica, quantità, carrello |

Nel configuratore 3D c’è l’icona del **manichino**: cliccandola il grembiule
compare indossato da un manichino bianco (si può ruotare allo stesso modo);
cliccandola di nuovo si torna al grembiule da solo.
| `#contatti`      | “Arriveranno presto”                                       |

Si può aprire il grembiule già in un colore: `#grembiule-verde`, `#grembiule-nero`…

Il menu a tendina è il pulsante **Menu** in alto a destra; accanto c’è il carrello.

## Come vederlo

- Doppio clic su `index.html` funziona anche senza server.
- Oppure, dalla cartella del progetto: `python3 -m http.server` e apri <http://localhost:8000>.
- Per pubblicarlo basta caricare la cartella così com’è (GitHub Pages, Netlify, qualsiasi hosting).

## Intro animata del logo

Ogni volta che si apre il sito parte da sola un’intro: un nido di fettuccine
cade, si srotola e le fettuccine si posano formando la parte gialla del logo;
poi compaiono le scritte, il logo vola al suo posto e solo dopo entrano
menu, testi e il resto della pagina. Si salta con “Salta intro”,
con un clic o con Esc. Per rivederla basta cliccare il logo grande della home.

Il codice è in `js/intro.js` (WebGL, senza librerie). Per toglierla del tutto
si cancella il blocco `INTRO ANIMATA DEL LOGO` in `index.html`.

## Modificare prezzo, colori e testi

Tutto in **`js/products.js`**:

- `prezzo`: ora è `0`; ad esempio `24.90` per 24,90 €.
- `colori`: `hex` è il pallino del colore, `tessuto` il colore del modello 3D,
  `ricamo` il colore delle scritte ricamate (bianco sui colori scuri, nero sul bianco).
- `descrizione`, `nome`, `taglie`.

Le pagine **Chi siamo** e **Contatti** sono in `index.html` (cerca `CHI SIAMO` e `CONTATTI`).

## Carrello e ordini

Il carrello resta salvato nel browser di chi visita il sito. Il pulsante
“Procedi all’ordine” per ora mostra solo un avviso: il pagamento online
(Stripe, PayPal, WhatsApp…) si collega in `js/app.js`, cercando `data-checkout`.

## Struttura

```
index.html            tutte le pagine (Home, Chi siamo, Catalogo, Contatti, configuratore, carrello)
css/style.css         stile del sito
js/products.js        catalogo: prezzi, colori, testi
js/app.js             menu a tendina, navigazione, carrello, configuratore
js/apron3d.js         modello 3D del grembiule (three.js)
js/intro.js           intro animata con le fettuccine (WebGL)
js/logo-data.js       ricamo del logo estratto dal logo originale (generato)
vendor/three.min.js   libreria three.js r159 (licenza MIT)
assets/img/           logo, icone, foto dei grembiuli
```

Il modello 3D e il ricamo sono generati nel browser: il grembiule cambia colore
all’istante senza scaricare immagini diverse. Lo script carica three.js solo
quando si apre il configuratore, così la home resta leggera.
