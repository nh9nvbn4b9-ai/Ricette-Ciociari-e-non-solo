/*
 * Catalogo prodotti.
 * Per cambiare prezzo, colori o testi basta modificare questo file.
 *  - prezzo: in euro (es. 24.90)
 *  - colori: "hex" è il colore del pallino, "tessuto" il colore del modello 3D,
 *            "ricamo" il colore del filo delle scritte ricamate.
 */
window.CATALOGO = [
  {
    id: 'grembiule',
    nome: 'Grembiule Ricette Ciociare',
    breve: 'Grembiule da cucina con logo ricamato',
    descrizione:
      'Grembiule da cucina con pettorina, laccio al collo, lacci in vita e tasca frontale. ' +
      'Il logo “Ricette Ciociare e non solo” è ricamato sul petto.',
    prezzo: 0,
    taglie: ['Unica'],
    immagine: 'assets/img/grembiuli-ricamati.jpg',
    coloreIniziale: 'rosso',
    colori: [
      { id: 'rosso', nome: 'Rosso', hex: '#d0141c', tessuto: '#b30d16', ricamo: '#f6f3ec' },
      { id: 'nero', nome: 'Nero', hex: '#1d1b1c', tessuto: '#121112', ricamo: '#f6f3ec' },
      { id: 'bianco', nome: 'Bianco', hex: '#f4f2ed', tessuto: '#eeebe4', ricamo: '#141313' },
      { id: 'verde', nome: 'Verde', hex: '#0f7a3d', tessuto: '#0a5c2e', ricamo: '#f6f3ec' }
    ]
  }
];
