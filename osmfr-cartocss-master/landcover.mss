#landcover {
  [feature = 'leisure_swimming_pool'] {
    polygon-fill: #9ff2fa;
    line-color: blue;
    line-width: 0.2;
    line-opacity: 0.5;
  }

  [feature = 'leisure_playground'] {
    polygon-fill: #ccfff1;
    line-color: #666;
    line-width: 0.3;
  }

  [feature = 'tourism_camp_site'],
  [feature = 'tourism_caravan_site'],
  [feature = 'tourism_picnic_site'] {
    polygon-fill: #ccff99;
    polygon-opacity: 0.5;
    line-color: #666;
    line-width: 0.3;
  }

  [feature = 'tourism_museum'],
  [feature = 'tourism_attraction'] {
    polygon-fill: #f2caea;
  }

  [feature = 'landuse_quarry'] {
    polygon-pattern-file: url('symbols/quarry2.png');
    polygon-pattern-alignment: global;
    line-width: 0.5;
    line-color: grey;
  }

  [feature = 'landuse_vineyard'] {
    polygon-fill: #abdf96;
    [zoom >= 13] {
      polygon-pattern-file: url('symbols/vineyard.png');
      polygon-pattern-alignment: global;
    }
  }

  [feature = 'landuse_greenhouse_horticulture'] {
    polygon-fill: #c5d2b4;
  }

  [feature = 'landuse_plant_nursery'] {
    polygon-fill: #c5d2b4;
  }

  [feature = 'landuse_orchard'] {
    polygon-pattern-file: url('symbols/orchard.png');
    polygon-pattern-alignment: global;
  }

  [feature = 'landuse_cemetery'],
  [feature = 'landuse_grave_yard'],
  [feature = 'amenity_grave_yard'] {
    polygon-fill: #aacbaf;
    [zoom >= 14] {
      polygon-pattern-file: url('symbols/grave_yard_generic.png');
      polygon-pattern-alignment: global;
    }
  }

  [feature = 'landuse_residential'] {
    polygon-fill: #ddd;
  }

  [feature = 'landuse_garages'] {
    polygon-fill: #996;
    polygon-opacity: 0.2;
  }

  [feature = 'military_barracks'][building != ''] {
    polygon-fill: #ff8f8f;
  }

  [feature = 'landuse_field'] {
    polygon-fill: #666600;
    polygon-opacity: 0.2;
    [zoom >= 14] {
      line-width: 0.3;
      line-opacity: 0.4;
      line-color: #660;
    }
  }

  [feature = 'military_danger_area'] {
    polygon-fill: pink;
    polygon-opacity: 0.3;
    [zoom >= 11] {
      polygon-pattern-file: url('symbols/danger.png');
      polygon-pattern-alignment: global;
    }
  }

  [feature = 'landuse_meadow'],
  [feature = 'landuse_grass'],
  [feature = 'landuse_flowerbed'],
  [feature = 'natural_marsh'],
  [feature = 'wetland_marsh'],
  [feature = 'wetland_bog'],
  [feature = 'wetland_reedbed'],
  [feature = 'wetland_wet_meadow'] {
    polygon-fill: #cfeca8;
  }

  [feature = 'natural_reef'] {
    polygon-pattern-file: url('symbols/reef.png');
    polygon-pattern-alignment: global;
  }
  
  [feature = 'leisure_park'],
  [feature = 'leisure_recreation_ground'] {
    polygon-fill: #b6fdb6;
    polygon-opacity: 0.6;
  }

  [feature = 'tourism_zoo'] {
    polygon-pattern-file: url('symbols/zoo.png');
    polygon-pattern-alignment: global;
  }

  [feature = 'leisure_common'] {
    polygon-fill: #cfeca8;
  }

  [feature = 'leisure_garden'] {
    polygon-fill: #cfeca8;
  }

  [feature = 'leisure_golf_course'] {
    polygon-fill: #b5e3b5;
  }

  [feature = 'landuse_allotments'] {
    polygon-fill: #e5c7ab;
    [zoom >= 14] {
      polygon-pattern-file: url('symbols/allotments.png');
      polygon-pattern-alignment: global;
    }
  }

  [feature = 'natural_wood'],
  [feature = 'landuse_wood'],
  [feature = 'landuse_forest'],
  [feature = 'wetland_swamp'] {
    polygon-fill: #8dc56c;
    [wood='coniferous'],[wood='needleleaved'] { polygon-fill: #74b551; }
    [zoom >= 14] {
      polygon-pattern-file: url('symbols/fr/forest.png');
      polygon-pattern-alignment: global;
      [wood='mixed'] { polygon-pattern-file: url('symbols/fr/forest_mixed.png'); }
      [wood='coniferous'],[wood='needleleaved'] { polygon-pattern-file: url('symbols/fr/forest_coniferous.png'); }
      [wood='deciduous'],[wood='broadleaved'] { polygon-pattern-file: url('symbols/fr/forest_deciduous.png'); }
    }
  }

  [feature = 'landuse_farmyard'] {
    polygon-fill: darken(#f2e4ce,10%);
  }

  [feature = 'landuse_farm'],
  [feature = 'landuse_farmland'] {
    polygon-fill: #f2e4ce;
  }

  [feature = 'landuse_recreation_ground'],
  [feature = 'landuse_conservation'] {
    polygon-fill: #cfeca8;
  }

  [feature = 'landuse_village_green'] {
    polygon-fill: #cfeca8;
  }

  [feature = 'landuse_retail'] {
    polygon-fill: #f1dada;
    [zoom >= 15] {
      line-width: 0.3;
      line-color: red;
    }
  }

  [feature = 'man_made_wastewater_plant'],
  [feature = 'man_made_works'],
  [feature = 'man_made_gasometer'] {
    polygon-fill: @industrial-color;
    line-width: 0.3;
  }

  [feature = 'landuse_industrial'],
  [feature = 'landuse_harbour'],
  [feature = 'landuse_railway'] {
      polygon-fill: @industrial-color;
  }

  [feature = 'power_plant'],
  [feature = 'power_station'],
  [feature = 'power_generator'] {
    polygon-fill: #bbb;
    [zoom >= 12] {
      line-width: 0.4;
      line-color: #555;
    }
  }

  [feature = 'power_substation'],
  [feature = 'power_sub_station'] {
    polygon-fill: #bbb;
    line-width: 0.5;
    line-color: #555;
  }

  [feature = 'landuse_commercial'] {
    polygon-fill: #efc8c8;
  }

  [feature = 'landuse_brownfield'],
  [feature = 'landuse_landfill'],
  [feature = 'landuse_greenfield'],
  [feature = 'landuse_construction'] {
    polygon-fill: #9d9d6c;
    polygon-opacity: 0.7;
  }

  [feature = 'natural_desert'],
  [feature = 'natural_sand'] {
    polygon-fill: #ffebb2;
  }

  [feature = 'natural_heath'] {
    polygon-fill: #d6d99f;
  }

  [feature = 'natural_grassland'] {
    polygon-fill: #c6e4b4;
  }

  [feature = 'natural_bare_rock'] {
    polygon-fill: @land-color;
    polygon-pattern-file: url('symbols/fr/rocky_overlay.png');
    polygon-pattern-alignment: global;
    polygon-pattern-opacity: 0.5;
    polygon-pattern-transform: "scale(0.25)";
  }

  [feature='man_made_clearcut'],
  [feature = 'natural_scrub'] {
    polygon-fill: #b5e3b5;
    [zoom >= 14] {
      polygon-pattern-file: url('symbols/scrub.png');
      polygon-pattern-alignment: global;
    }
  }

  [feature = 'amenity_university'],
  [feature = 'amenity_college'],
  [feature = 'amenity_school'],
  [feature = 'landuse_school'],
  [feature = 'landuse_education'],
  [feature = 'amenity_hospital'],
  [feature = 'amenity_clinic'],
  [feature = 'amenity_social_facility'],
  [feature = 'amenity_kindergarten'] {
    polygon-fill: #f0f0d8;
    [zoom >= 12] {
      line-width: 0.3;
      line-color: brown;
    }
  }

  [feature = 'amenity_parking'],
  [feature = 'amenity_car_pooling'] {
    polygon-fill: #e8e8e8;
    [zoom >= 15] {
      line-width: 0.3;
      line-color: #eeeed1;
    }
  }

  [feature = 'amenity_parking_space'] {
    line-width: 0.25;
    line-color: #aaa;
  }

  [feature = 'aeroway_apron'] {
    polygon-fill: #e9d1ff;
  }

  [feature = 'aeroway_aerodrome'] {
    polygon-fill: #666;
    polygon-opacity: 0.2;
    line-width: 0.2;
    line-color: #555;
  }

  [feature = 'natural_beach'] {
    polygon-pattern-file: url('symbols/beach.png');
    polygon-pattern-alignment: global;
  }

  [feature = 'highway_services'],
  [feature = 'highway_rest_area'] {
    polygon-fill: #efc8c8;
  }

  [feature = 'amenity_recycling'] {
    polygon-fill: @industrial-color;
    [zoom >= 16]{
    	line-color: #093;
    	line-dasharray: 8,8;
    }
  }

  [feature = 'amenity_place_of_worship'],
  [feature = 'amenity_public_building'],
  [feature = 'amenity_townhall'],
  [feature = 'amenity_courthouse'],
  [feature = 'amenity_police'],
  [feature = 'amenity_post_office'],
  [feature = 'amenity_theatre'],
  [feature = 'amenity_community_centre'],
  [feature = 'building_civic'],
  [feature = 'building_public']
  {
    polygon-fill: #aaa;
  }

  [feature = 'leisure_sports_centre'],
  [feature = 'leisure_stadium'] {
    polygon-fill: #33cc99;
    polygon-opacity: 0.25;
  }

  [feature = 'leisure_track'] {
    polygon-fill: #74dcba;
    line-width: 0.5;
    line-color: #888;
  }

  [feature = 'leisure_pitch'] {
    polygon-fill: #8ad3af;
    line-width: 0.5;
    line-color: #888;
  }

}

/* man_made=cutline */
#landcover-line {
  line-width: 3;
  line-join: round;
  line-cap: square;
  line-color: @land-color;
  [zoom >= 16] {
    line-width: 6;
  }
}


#landuse-overlay [zoom >= 10] {
  [amenity = 'prison'],
  [landuse = 'military'] {
    polygon-pattern-file: url('symbols/military_red_hz2.png');
    polygon-pattern-alignment: global;
    polygon-pattern-opacity: 0.66;
    line-color: #f55;
    line-width: 2;
    line-opacity: 0.25;
  }
  [leisure = 'nature_reserve'] {
    polygon-pattern-file: url('symbols/fr/nature_reserve6.png');
    polygon-pattern-alignment: global;
    a/line-color: green;
    a/line-width: 1;
    a/line-opacity: 0.7;
    b/line-color: green;
    b/line-width: 2;
    b/line-opacity: 0.5;
    b/line-offset: -1;
    c/line-color: green;
    c/line-width: 2;
    c/line-opacity: 0.3;
    c/line-offset: -3;
    d/line-color: green;
    d/line-width: 2;
    d/line-opacity: 0.1;
    d/line-offset: -5;
  }
  [natural = 'marsh'],
  [natural = 'wetland'] {
    polygon-pattern-file: url('symbols/wetland.png');
    polygon-pattern-alignment: global;
  }

}

#area-text [zoom >= 11] {
  [heritage!='']::heritage {
    [pixels >= @area_text_pixels],
    [zoom >= 17] {
      text-name: "[nom]";
      [zoom >= 17] { text-name: "[name]"; }
      text-halo-radius: 1;
      text-clip: false;
      text-placement: interior;
      text-placement-type: simple;
      // variation de la texte du texte en fonction de la surface du polygone
      text-size: 10;
      text-wrap-width: 30;
      text-placements: 'X,10,9';
      // taille du texte en fonction de la surface du polygone (en pixels)
      [pixels >= @area_text_pixels * 4] {
        text-size: 11;
        text-wrap-width: 40;
        text-placements: 'X,11,10,9';
      }
      [pixels >= @area_text_pixels * 8] {
        text-size: 12;
        text-wrap-width: 50;
        text-placements: 'X,12,11,10,9';
      }
      [pixels >= @area_text_pixels * 16] {
        text-size: 14;
        text-wrap-width: 60;
        text-placements: 'X,14,13,12,11,10,9';
      }
      [pixels >= @area_text_pixels * 32] {
        text-size: 16;
        text-wrap-width: 80;
        text-placements: 'X,16,15,14,13,12,11,10,9';
      }
      text-face-name: @bold-fonts;
  	 	text-fill: #734a08;
  	}
  }

  [pixels >  @area_text_pixels],
  [zoom >= 17] {
    text-face-name: @oblique-fonts;
    text-name: "[nom]";
    [zoom >= 17] { text-name: "[name]"; }
    text-halo-radius: 1;
    text-avoid-edges: true;
    text-placement: interior;
    text-margin: 4;
    text-placement-type: simple;
    text-size: 10;
    text-wrap-width: 30;
    text-placements: 'X,10,9';
    // taille du texte en fonction de la surface du polygone (en pixels)
    [pixels > (@area_text_pixels * 4)] {
      text-size: 11;
      text-wrap-width: 40;
      text-placements: 'X,11,10,9';
    }
    [pixels > (@area_text_pixels * 8)] {
      text-size: 12;
      text-wrap-width: 50;
      text-placements: 'X,12,11,10,9';
    }
    [pixels > (@area_text_pixels * 16)] {
      text-size: 14;
      text-wrap-width: 60;
      text-placements: 'X,14,13,12,11,10,9';
    }
    [pixels > (@area_text_pixels * 32)] {
      text-size: 16;
      text-wrap-width: 80;
      text-placements: 'X,16,15,14,13,12,11,10,9';
    }

  	text-fill: #444; // default: industrial, residential, brownfield, cemetery, construction, farm/farmland/farmyard, garages,landfill, quarry, railway...

    // couleur en fonction du type de polygone
  	[kind=~'(water|reservoir|basin|salt_pond|marina|bay|glacier)']
    {
      text-fill: #068;
    }
    [kind=~'(forest|wood|allotments|meadow|vineyard|orchard|grass|greenhouse_horticulture|recreation_ground)']
    {
      text-fill: #050;
    }
    [kind=~'(retail|mall|supermarket|department_store)'] {
      text-fill: darken(@shop-icon,25%);
    }
    [kind=~'commercial'] {
      text-fill:  darken(pink,50%);
    }
    [kind=~'military'] {
      text-fill: #c00;
    }
    [kind=~'(park|nature_reserve|playground|pitch|golf_course|garden|horse_riding|stadium|sports_centre)'] {
      text-fill: #060;
    }
    [kind=~'(hospital|clinic)'] {
      text-fill: @health-color;
    }
    [kind=~'(school|education|university|college)'] {
      text-fill: #440;
    }
    [kind=~'golf_course'][zoom>=14]{ text-name: ""; } // icone en double sinon...
  }
}
