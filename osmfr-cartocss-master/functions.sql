CREATE TABLE public.params (
    key text,
    txt text,
    num numeric
);
INSERT INTO public.params VALUES ('y_bleed', '0', 0);
INSERT INTO public.params VALUES ('x_bleed', '0', 0);
INSERT INTO public.params VALUES ('buffer', '0', 0);

GRANT SELECT ON TABLE params TO PUBLIC;


-- table contours
CREATE TABLE contours (
	contour geometry,
	ele integer
	);


--
-- Name: fr_abbrev(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION fr_abbrev(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ select
    /* 32 regexp maxi !!!*/
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
        replace($1,
    'lémentaire ','lem. '),
    'econdaire ','econd. '),
    'rimaire ','rim. '),
    'aternelle ','at. '),
    'olyvalent ','ol. '),
    'ommerciale ','omm. '),
    'Direction ','Dir. '),
    'Esplanade ','Espl. '),
    'Pointe ','Pᵗᵉ '),
    'Chapelle ','Chap. '),
    'Cathédrale ','Cath. '),
    ' Notre-Dame ',' N.D. '),
    'Avenue ','Av. '),
    'Autoroute ','Aut. '),
    'Boulevard ','Bd. '),
    'Faubourg ','Fbg. '),
    'Passage ','Pass. '),
    'Place ','Pl. '),
    'Promenade ','Prom. '),
    'Impasse ','Imp. '),
    'Centre Commercial ','CCial. '),
    'Domaine ','Dom. '),
    'Jardin ','Jard. '),
    'Immeuble ','Imm. '),
    'Lotissement ','Lot. '),
    'Résidence ','Rés. '),
    'Square ','Sq. '),
    'Zone Industrielle ','ZI. '),
    'Adjudant ','Adj. '),
    'Agricole ','Agric. '),
    'Arrondissement','Arrond.'),
    'Aspirant ','Asp. '),
    'Boulangerie ','Boul. '),
    'Colonel ','Col. '),
    'Commandant ','Cdt. '),
    'Capitaine ','Capt. '),
    'Commercial ','Cial. '),
    'Coopérative ','Coop. '),
    'Division ','Div. '),
    'Docteur ','Dr. '),
    'Général ','Gén. '),
    'Habitation ','Hab. '),
    'Institut ','Inst. '),
    'Impératrice ','Impér. '),
    'Faculté ','Fac. '),
    'Laboratoire ','Labo. '),
    'Lieutenant ','Lt. '),
    'Maréchal ','Mal. '),
    'Ministère ','Min. '),
    'Monseigneur ','Mgr. '),
    'Médiathèque ','Médiat. '),
    'National ','Nat. '),
    'Bibliothèque ','Bibl. '),
    'Tribunal ','Trib. '),
    'Observatoire ','Obs. '),
    'Pharmacie ','Pharm. '),
    'Périphérique ','Périph. '),
    'Préfecture ','Préf. '),
    'Chevalier ','Chev. '),
    'Président ','Pdt. '),
    'Régiment ','Rgt. '),
    'Saint-','Sᵗ-'),
    'Sainte-','Sᵗᵉ-'),
    'Sergent ','Sgt. '),
    'Université ','Univ. '),
    'Hôpital ','Hôp. '),
    'Collège ','Coll. '),
    'Cimetière ','Cim. '),
    'Groupe Scolaire ','Grp. Scol. '),
    'Onze ','11 '),
    'Quatorze ','14 '),
    /* expressions régulières (32 maximum !!! */
    'Communauté d.[Aa]gglomération','Comm. d''agglo. '),
    'Communauté [Uu]rbaine ','Comm. urb. '),
    'Communauté de [Cc]ommunes ','Comm. comm. '),
    'Syndicat d.[Aa]gglomération ','Synd. d''agglo. '),
    '^Chemin ','Ch. '),
    '^Institut ','Inst. '),
    'Zone d.[Aa]ctivité.? [Éeée]conommique.? ','Z.A.E. '),
    'Zone d.[Aa]ctivité.? ','Z.A. '),
    'Zone [Aa]rtisanale ','Zone Art. '),
    'Zone [Ii]ndustrielle ','Z.I. '),
    ' [Pp]ubli(c|que) ',' Publ. '),
    ' [Pp]rofess(eur|ionnel(|le)) ',' Prof. '),
    ' [Tt]echnologique ',' Techno. '),
    ' [Pp]olyvalent ',' Polyv. '),
    '[EÉeé]tablissement(|s) ','Éts. '),
    ' [Mm]unicipa(l|le|ux)( |$)',' Munic. '),
    ' [Dd]épartementa(l|le|ux)( |$)',' Départ. '),
    ' [Ii]ntercommuna(l|le|ux)( |$)',' Interco. '),
    ' [Rr]égional(|e)( |$)',' Région. '),
    ' [Ii]nterdépartementa(l|le|ux)( |$)',' Interdép. '),
    ' [Hh]ospitali(er|ère) ',' Hospit. '),
    ' [EÉeé]lectrique ',' Élect. '),
    ' [Ss]upérieur(|e) ',' Sup. '),
    '^[Bb][aâ]timents? ','Bât. '),
    '[Aa]éronautique ','Aéron. ')
$$;

--
-- Name: to_int(text); Type: FUNCTION; Schema: public; Owner: osm2pgsql
--

CREATE OR REPLACE FUNCTION to_int(text) RETURNS bigint
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $_$ select coalesce(left(regexp_replace($1,'^(|\-)([0-9]*).*','\10\2'),12),'0')::bigint; $_$;

--
-- Name: bbbox, computes the "bleed" bbox, with margins
-- example: st_intersection(bbbox(!bbox!,!pixel_width!,!pixel_height!,0),way)

CREATE OR REPLACE FUNCTION bbbox(box2d,float,float,integer) RETURNS geometry
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $_$
select ST_SetSRID(ST_MakeBox2D(ST_Point(ST_XMin($1)+$2*((select num from params where key='x_bleed')+(select num from params where key='buffer')+$4),ST_Ymin($1)+$3*((select num from params where key='y_bleed')+(select num from params where key='buffer')+$4)), ST_Point(ST_XMax($1)-$2*((select num from params where key='x_bleed')+(select num from params where key='buffer')+$4),ST_Ymax($1)-$3*((select num from params where key='y_bleed')+(select num from params where key='buffer')+10))),3857);
$_$;


CREATE OR REPLACE FUNCTION fr_prenoms(text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$ select
regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
$1,
    '(Jean|John|Johann?)-','J–'),
    'Pierre-','P–'),
    'Marie-','M–'),
    'Anne-','A–'),
    '([^-])(Abel|Achille|Ad[eé]laïde|Adèle|Adeline|Adolphe|Adrienn?e?|Agathe|Agnès|Aimée?|Alain|Alberte?|Alexandr?e?r?|Alexis|Alfred|Alphonse|Ambroise|Amédée|Anatole|Andrée?|Anna|Anne|Anita|Angèle|Angela|Anselme|Anthelme|Antoine|Apolline|Aristide|Armand|Armel|Arthur|Astride|Athanase|Auban|Aubin|Aude|Auguste|Augustin|Aurèle|Amadeus) ([^0-9]*[a-z])','\1A. \3'),
    '([^-])(Bap?tiste|Barbe|Barnabé|Barthélemy|Basile|Benjamin|Benoîte?|Bérenger|Bernadette|Bernard|Bernardin|Bertille|Berthi?e|Bibiane|Blaise|Bonaventure|Boniface|Boris|Brice|Brigitte|Bruno) ([^0-9]*[a-z])','\1B. \3'),
    '([^-])(Charles|Christine|Christophe|Christiane?|Chantal) ([^0-9]*[a-z])','\1Ch. \3'),
    '([^-])(Camille|Caroline|Casimir|Catherine|Cécile|Célestine?|Céline|César|Claire|Claude|Clément|Clotilde|Colette|Constant|Constantin|Corentin|Cyrille) ([^0-9]*[a-z])','\1C. \3'),
    '([^-])(Daniel|Danielle|Darius|David|Denise?|Désirée?|Didier|Dominique|Delano) ([^0-9]*[a-z])','\1D. \3'),
    '([^-])(Edith|Edgar|Edmonde?|Edmée?|[EÉ]douard|[ÉE]lisabeth|[EÉ]lisé?e|[EÉ]loi|Elsa|Emmanuell?e?|[ÉE]mile|[ÉE]ric|Erik|Ernest|Estelle|[EÉ]tienne|Eug[éè]ni?e|[EÉ]variste) ([^0-9]*[a-z])','\1E. \3'),
    '([^-])(Fabien|Faustine|Ferdinand|Félix|Fernande?|Fiacre|Fidèle|Firmin|Florian|Florence|Florentin|Francisc?o?|Françoise?|Franck|Franklin|Frédéric|Frédérique|Fitzgerald) ([^0-9]*[a-z])','\1F. \3'),
    '([^-])(Gabriel|Gaétan|Gaston|Gatien|Gautier|Geneviève|Geoffroy|Georges?|Georgette|Gérald|Géraldine|Gérard|Germaine?|Gilberte?|Gildas|Gilles|Giordano|Gisèle|Gladys|Grégoire|Guénolé|Guillaume|Gustave|Guy) ([^0-9]*[a-z])','\1G. \3'),
    '([^-])(Habib|Hector|Hélène|Henri|Henry|Herbert|Hermann?|Hervé|Hilaire|Hippolyte|Honorat|Honoré|Honorine|Hubert|Hugues) ([^0-9]*[a-z])','\1H. \3'),
    '([^-])(Ignace|Ingrid|Irène|Irénée|Isaac|Isidore|Itzhak) ([^0-9]*[a-z])','\1I. \3'),
    '([^-])(Jack|Jacky|Jackie|Jacques|Jacqueline|J[eo]an|Jeanne|Jérémie|Jérôme|Johann?|Josepha?e?|Joséphine|Judicaël|Judith|Jules|Julien?|Julienne|Juliette|Juste|Justine?|John) ([^0-9]*[a-z])','\1J. \3'),
    '([^-])(Kevin|Karl) ([^0-9]*[a-z])','\1K. \3'),
    '([^-])(Lattre|Laurent|Lauri?e|Laura|Léon|Léandre|Léonard|Léonce|Lise|Louise?|Louison|Lucien?n?e?|Ludwig) ([^0-9]*[a-z])','\1L. \3'),
    '([^-])(Madeleine|Mar[ckx]|Marcel|Marcell?ine?|Marguerite|Maria|Marie|Marthe|Martial|Martine?|Maryse|Mathilde|Matthias|Matthieu|Maurice|Maxime|Maximilien|Michel|Michelle|Modeste|Monique) ([^0-9]*[a-z])','\1M. \3'),
    '([^-])(Narcisse|Nathalie|Nelson|Nestor|Nicolas|Nino|Norbert) ([^0-9]*[a-z])','\1N. \3'),
    '([^-])(Odile|Olive|Olivier|Olympe|Octave|Olof) ','\1O. \3'),
    '([^-])(Philiberte?|Philippe) ','\1Ph. \3'),
    '([^-])(Pablo|Pacôme|Parfait|Pascale?|Patrick|Paule?|Pauline?|Pierre|Prosper) ([^0-9]*[a-z])','\1P. \3'),
    '([^-])(Quentin) ','\1Q. \3'),
    '([^-])(Ralph|Raoul|Raphaël|Raymond|Remi|Rémi|Régine|Renée?|Richard|Rita|Roberte?|Roger|Rolande?|Romain|Romuald|Rosa|Rosalie|Rose|Rosine) ([^0-9]*[a-z])','\1R. \3'),
    '([^-])(Sabine?|Salomé|Salomon|Salvador|Samson|Samuel|Sauveur|Sébastien|Serge|Sernin|Séverine?|Silvaine?|Simone?|Solange|Sophie|Stanislas|Stéphani?e|Suzanne|Sylvaine?|Sylvestre) ([^0-9]*[a-z])','\1S. \3'),
    '([^-])(Tanguy|Tatiana|Tino) ([^0-9]*[a-z])','\1T. \3'),
    '([^-])(Théodore|Thérèse|Thierry|Thomas|Théodule|Thomy) ([^0-9]*[a-z])','\1Th. \3'),
    '([^-])(Ulric|Ursule) ','\1U. \3'),
    '([^-])(Valentine?|Valérie|Venceslas|Véronique|Victor|Vincent|Virgile|Vladimir) ([^0-9]*[a-z])','\1V. \3'),
    '([^-])(Youri|Yves|Yvon|Yvonne|Yvette|Yvan) ([^0-9]*[a-z])','\1Y. \3'),
    '([^-])(Waldeck|Winston|Wolfgang) ([^0-9]*[a-z])','\1W. \3'),
    '([^-])(Xavi[eè]re?) ([^0-9]*[a-z])','\1X. \3');
    $$;


-- création de la table des noms abrégés
CREATE TABLE IF NOT EXISTS abrev (long_name text, abrev_prenoms text, abrev text);
GRANT SELECT ON TABLE abrev TO PUBLIC;
CREATE UNIQUE INDEX IF NOT EXISTS abrev_index ON abrev (long_name);

-- remplissage de la table avec les odonymes des territoires français
INSERT INTO abrev
SELECT
    l.name as long_name,
    fr_prenoms(l.name) as abrev_prenoms,
    null as abrev
FROM planet_osm_polygon p
JOIN planet_osm_line l ON l.way && p.way
WHERE p.boundary= 'administrative' and p.admin_level='3'
    and (p.tags ? 'ref:INSEE'
        or p.name in ('France métropolitaine','Guadeloupe','Martinique','Mayotte','La Réunion','Guyane'))
    AND l.name is not null
    AND l.highway is not null
GROUP BY 1,2
ON CONFLICT DO NOTHING; -- 15mn

-- remplissage de la table avec les toponymes
INSERT INTO abrev
SELECT
    l.name as long_name,
    fr_prenoms(l.name) as abrev_prenoms,
    null as abrev
FROM planet_osm_polygon p
JOIN planet_osm_point l ON l.way && p.way
WHERE p.boundary= 'administrative' and p.admin_level='3'
    and (p.tags ? 'ref:INSEE'
        or p.name in ('France métropolitaine','Guadeloupe','Martinique','Mayotte','La Réunion','Guyane'))
    AND l.name is not null
ON CONFLICT DO NOTHING; -- 11mn

INSERT INTO abrev
SELECT
    l.name as long_name,
    fr_prenoms(l.name) as abrev_prenoms,
    null as abrev
FROM planet_osm_polygon p
JOIN planet_osm_polygon l ON l.way && p.way
WHERE p.boundary= 'administrative' and p.admin_level='3'
    and (p.tags ? 'ref:INSEE'
        or p.name in ('France métropolitaine','Guadeloupe','Martinique','Mayotte','La Réunion','Guyane'))
    AND l.name is not null
ON CONFLICT DO NOTHING; -- 25mn

-- remplissage de la table avec les odonymes des pays francophones
INSERT INTO abrev
SELECT
    coalesce(l.tags->'name:fr',l.name) as long_name,
    fr_prenoms(coalesce(l.tags->'name:fr',l.name)) as abrev_prenoms,
    null as abrev
FROM planet_osm_polygon p
JOIN planet_osm_line l ON l.way && p.way
WHERE p.boundary= 'administrative' and p.admin_level='2'
    and coalesce(p.tags->'name:fr', p.name) in ('Belgique','Bénin','Burkina Faso',E'Côte d\x027Ivoire', 'Gabon','Guinée','Mali','Monaco','Niger','Sénégal','Togo','Suisse')
    AND l.name is not null
    AND l.highway is not null
GROUP BY 1,2
ON CONFLICT DO NOTHING;


-- application des règles d'abréviation générales
UPDATE abrev SET (abrev_prenoms, abrev) = (fr_abbrev(abrev_prenoms), fr_abbrev(long_name)) WHERE abrev IS NULL; -- 6mn

-- on ne garde que les noms abrégés
DELETE FROM abrev where long_name=abrev_prenoms and long_name=abrev;
VACUUM FULL ANALYZE abrev;

-- pour vérifier l'intégrité des données (compressed data error)
create function chk(anyelement)
  returns bool 
  language plpgsql as $f$ 
    declare t text; 
    begin t := $1; 
      return false; 
      exception when others then return true; 
    end; 
  $f$;


-- récupération de la version abrégée d'un libellé
create function abrev(name text)
returns text
language plpgsql
as
$$
declare
   abrev_name text;
begin
   select abrev
   into abrev_name
   from abrev
   where long_name = name;
   return abrev_name;
end;
$$;

create function abrev_prenoms(name text)
returns text
language plpgsql
as
$$
declare
   abrev_name text;
begin
   select abrev_prenoms
   into abrev_name
   from abrev
   where long_name = name;
   return abrev_name;
end;
$$;